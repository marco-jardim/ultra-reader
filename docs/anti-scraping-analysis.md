# Anti-Scraping Analysis — ultra-reader

> Auditoria completa dos mecanismos anti-bot e o estado de mitigação no `@vakra-dev/reader` v0.1.2.  
> Data: 2026-02-07

---

## 1. Arquitetura do Scraper

O projeto usa um **cascade pattern de 3 engines**, tentados em ordem de velocidade:

```
HTTP Engine (native fetch, ~60-70% sites estáticos)
    ↓ fallback
TLS Client Engine (got-scraping, TLS fingerprint de browser)
    ↓ fallback
Hero Engine (Chromium completo via Ulixee Hero)
```

Cada engine tem timeouts próprios e o orchestrator (`src/engines/orchestrator.ts`) decide quando escalar para a próxima engine baseado no tipo de erro (challenge, conteúdo insuficiente, HTTP 403/429/5xx).

---

## 2. Lista Completa de Mecanismos Anti-Bot Conhecidos

### 2.1 Controle de Acesso por Protocolo

| #   | Mecanismo                           | Descrição                                                 |
| --- | ----------------------------------- | --------------------------------------------------------- |
| 1   | **robots.txt**                      | Arquivo que define regras de acesso para crawlers         |
| 2   | **Meta robots / X-Robots-Tag**      | Diretivas HTML/HTTP para crawlers (`noindex`, `nofollow`) |
| 3   | **Login walls / auth requirements** | Conteúdo atrás de autenticação                            |
| 4   | **API token requirements**          | Endpoints protegidos por API keys                         |
| 5   | **CORS/Origin restrictions**        | Bloqueia requisições cross-origin                         |

### 2.2 Análise de Rede e Transporte

| #   | Mecanismo                          | Descrição                                                         |
| --- | ---------------------------------- | ----------------------------------------------------------------- |
| 6   | **IP rate limiting / throttling**  | Limite de requisições por IP/tempo                                |
| 7   | **IP reputation / blacklists**     | Bloqueio de IPs de datacenters/VPNs conhecidos                    |
| 8   | **Geo-blocking**                   | Bloqueio por localização geográfica                               |
| 9   | **TLS fingerprinting (JA3/JA4)**   | Identifica client pela assinatura TLS (cipher suites, extensions) |
| 10  | **HTTP/2 fingerprinting (Akamai)** | Análise de settings frames HTTP/2                                 |
| 11  | **TCP fingerprinting**             | Análise de parâmetros TCP (TTL, window size)                      |
| 12  | **DNS leak detection**             | DNS queries revelam origem real                                   |

### 2.3 Análise de Request HTTP

| #   | Mecanismo                           | Descrição                                           |
| --- | ----------------------------------- | --------------------------------------------------- |
| 13  | **User-Agent filtering**            | Bloqueia UAs de bots ou UAs incomuns/desatualizados |
| 14  | **Header order/consistency checks** | Ordem dos headers não bate com browser real         |
| 15  | **Referer header validation**       | Verifica se o referer é legítimo                    |
| 16  | **Cookie/session validation**       | Requer cookies de sessão válidos                    |

### 2.4 Desafios Ativos (Challenges)

| #   | Mecanismo                                      | Descrição                                 |
| --- | ---------------------------------------------- | ----------------------------------------- |
| 17  | **Cloudflare JS Challenge**                    | Desafio JavaScript automático             |
| 18  | **Cloudflare Turnstile** (managed/interactive) | Challenge invisível ou interativo         |
| 19  | **CAPTCHAs** (reCAPTCHA v2/v3, hCaptcha)       | Desafios visuais/interativos              |
| 20  | **Proof-of-Work challenges**                   | Exige computação antes de servir conteúdo |
| 21  | **WAF (Web Application Firewall)**             | Bloqueio por padrões de requisição        |

### 2.5 Bot Detection Enterprise

| #   | Mecanismo               | Descrição                                   |
| --- | ----------------------- | ------------------------------------------- |
| 22  | **Akamai Bot Manager**  | Device fingerprint + behavior analysis      |
| 23  | **PerimeterX / HUMAN**  | Bot detection baseado em comportamento      |
| 24  | **DataDome**            | Bot protection SaaS                         |
| 25  | **Kasada**              | Anti-bot via polymorphic JS + proof-of-work |
| 26  | **Shape Security (F5)** | Polymorphic JS challenges                   |

### 2.6 Browser Fingerprinting

| #   | Mecanismo                           | Descrição                                     |
| --- | ----------------------------------- | --------------------------------------------- |
| 27  | **Canvas fingerprinting**           | Hashing do rendering Canvas                   |
| 28  | **WebGL fingerprinting**            | Hashing de características WebGL              |
| 29  | **Audio fingerprinting**            | Hashing do processamento de áudio             |
| 30  | **Font enumeration**                | Detecta fontes instaladas                     |
| 31  | **Navigator/JS environment checks** | Verifica `navigator.webdriver`, plugins, etc. |
| 32  | **WebRTC IP leak detection**        | Revela IP real mesmo atrás de proxy           |
| 33  | **Device/screen resolution checks** | Viewport/resolução inconsistente              |

### 2.7 Análise Comportamental

| #   | Mecanismo               | Descrição                                      |
| --- | ----------------------- | ---------------------------------------------- |
| 34  | **Behavioral analysis** | Padrões de mouse, scroll, timing entre cliques |
| 35  | **Timing attacks**      | Requests muito rápidos/uniformes demais        |
| 36  | **Honeypot traps**      | Links invisíveis que só bots seguem            |

### 2.8 Obfuscação e Cloaking de Conteúdo

| #   | Mecanismo                                    | Descrição                                              |
| --- | -------------------------------------------- | ------------------------------------------------------ |
| 37  | **Agent poisoning / text cloaking**          | Texto diferente/envenenado para bots vs humanos        |
| 38  | **Content obfuscation** (CSS/JS/Canvas text) | Texto renderizado via CSS `::before`/`::after`, Canvas |
| 39  | **Shadow DOM / Web Components**              | Conteúdo encapsulado em shadow DOM                     |
| 40  | **iframe sandboxing**                        | Conteúdo em iframes cross-origin                       |

### 2.9 Conteúdo Dinâmico

| #   | Mecanismo                                                | Descrição                       |
| --- | -------------------------------------------------------- | ------------------------------- |
| 41  | **JavaScript rendering requirement**                     | Conteúdo carregado via JS/SPA   |
| 42  | **Dynamic content loading** (infinite scroll, lazy load) | Conteúdo que requer interação   |
| 43  | **GraphQL/REST anti-scrape**                             | Rate limit por query complexity |

---

## 3. Estado de Mitigação no ultra-reader

### 3.1 TOTALMENTE MITIGADO ✅

| #     | Mecanismo                      | Como é Mitigado                                                                                                                                                          | Arquivos                                                     |
| ----- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 17    | **Cloudflare JS Challenge**    | Detecção multi-sinal (DOM selectors + text patterns + infra indicators). Resolução via polling: URL redirect detection + signal disappearance. Timeout configurável 45s. | `src/cloudflare/detector.ts`, `src/cloudflare/handler.ts`    |
| 9     | **TLS fingerprinting (JA3)**   | Hero com `disableMitm: false` emula TLS fingerprint exato do Chrome. `got-scraping` também emula TLS de browser.                                                         | `src/browser/hero-config.ts:37-41`, `src/engines/tlsclient/` |
| 41    | **JS rendering**               | Chromium completo via Ulixee Hero. Espera por `DOMContentLoaded`, `PaintingStable`, `waitForSelector`.                                                                   | `src/engines/hero/index.ts`                                  |
| 32    | **WebRTC IP leak**             | `upstreamProxyIpMask` com `ipify.org` para mascarar IP real.                                                                                                             | `src/browser/hero-config.ts:67-72`                           |
| 12    | **DNS leak**                   | DNS over TLS via Cloudflare (1.1.1.1) no Hero.                                                                                                                           | `src/browser/hero-config.ts:57-63`                           |
| 31    | **Anti-headless detection**    | Ulixee Hero emula Chrome real: navigator properties, WebGL, Canvas, plugins.                                                                                             | `src/browser/hero-config.ts`                                 |
| 6     | **Rate limiting / throttling** | Delay configurável entre requests, `p-limit` para concurrency, respeita `Crawl-delay`. Exponential backoff nos retries.                                                  | `src/utils/rate-limiter.ts`, `src/crawler.ts:133-135`        |
| 7     | **IP reputation**              | Suporte a proxies datacenter e residenciais. Rotação round-robin/random. Sticky sessions.                                                                                | `src/proxy/config.ts`, `src/client.ts:92-107`                |
| 33    | **Viewport/resolution**        | Viewport 1920x1080, locale `en-US`, timezone `America/New_York`.                                                                                                         | `src/browser/hero-config.ts:76-86`                           |
| 27-29 | **Canvas/WebGL/Audio FP**      | Hero emula fingerprints consistentes e realistas.                                                                                                                        | Via Ulixee Hero internals                                    |

### 3.2 PARCIALMENTE MITIGADO ⚠️

| #   | Mecanismo                | O Que Funciona                                                                     | O Que Falta                                                                          | Arquivos                                             |
| --- | ------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| 1   | **robots.txt**           | Parser completo com Allow/Disallow/Crawl-delay, wildcards, `$` anchors.            | **Não há opção de bypass.** Sempre respeita robots.txt — lança `RobotsBlockedError`. | `src/utils/robots-parser.ts`, `src/scraper.ts:57-63` |
| 13  | **User-Agent**           | UA hardcoded Chrome 120 no HTTP engine. `got-scraping` gera UA. Hero emula Chrome. | **UA é estático e desatualizado** (Chrome/120 = dez 2023). Sem rotação.              | `src/engines/http/index.ts:23-24`                    |
| 16  | **Cookies/session**      | Hero gerencia cookies via Chromium. Pool recicla instâncias.                       | **Sem persistência entre sessões.** Sem cookie injection.                            | `src/browser/pool.ts`                                |
| 14  | **Header consistency**   | HTTP engine inclui `Sec-Fetch-*` headers completos.                                | **Ordem fixa.** Sem randomização de header order.                                    | `src/engines/http/index.ts:22-35`                    |
| 8   | **Geo-blocking**         | Proxies residenciais suportam `country` param.                                     | **Depende de ter proxies no país certo.** Sem fallback geográfico.                   | `src/proxy/config.ts:41-49`                          |
| 18  | **Cloudflare Turnstile** | Managed mode (invisível) resolvido automaticamente pelo Hero.                      | **Interactive mode não resolvido.** Sem integração com CAPTCHA solver.               | `src/cloudflare/detector.ts`                         |

### 3.3 NÃO MITIGADO ❌

| #     | Mecanismo                                                         | Gravidade  | Detalhes                                                                                                                                                                              |
| ----- | ----------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19    | **CAPTCHAs (reCAPTCHA, hCaptcha)**                                | 🔴 CRÍTICO | Nenhuma integração com serviços de solving (2Captcha, Anti-Captcha, CapMonster). Documentação admite a limitação em `docs/guides/cloudflare-bypass.md:186-197`.                       |
| 37    | **Agent poisoning / text cloaking**                               | 🔴 CRÍTICO | Zero detecção de conteúdo envenenado. Não compara conteúdo entre engines. Não detecta texto oculto via CSS (`display:none`, `font-size:0`). Não verifica `<noscript>` vs renderizado. |
| 34    | **Behavioral analysis evasion**                                   | 🔴 ALTO    | Zero simulação de comportamento humano: mouse movements, scroll, random delays entre ações, click patterns. Hero vai direto ao `goto()` → `waitForLoad()` → extract.                  |
| 22-26 | **Enterprise WAFs** (Akamai, PerimeterX, DataDome, Kasada, Shape) | 🔴 ALTO    | Zero handling para WAFs enterprise além do Cloudflare. Sem detecção, sem bypass, sem fallback.                                                                                        |
| 36    | **Honeypot trap detection**                                       | 🟡 MÉDIO   | Sem detecção de links invisíveis (`display:none`, `aria-hidden`, `tabindex=-1`, `opacity:0`). Crawler pode seguir honeypots e ser banido.                                             |
| 15    | **Referer header spoofing**                                       | 🟡 MÉDIO   | HTTP engine não seta `Referer`. Sites que verificam referer (Google/próprio domínio) bloquearão.                                                                                      |
| 42    | **Dynamic content (scroll, lazy load)**                           | 🟡 MÉDIO   | `waitForSelector` existe mas sem scroll simulation, sem trigger de lazy loading, sem "Load More" buttons.                                                                             |
| 3     | **Login walls / auth**                                            | 🟡 MÉDIO   | Sem suporte a cookie injection, session replay, OAuth flow. Cookies podem ser passados via headers mas é manual.                                                                      |
| 10    | **HTTP/2 fingerprinting**                                         | 🟡 MÉDIO   | `got-scraping` lida parcialmente. HTTP engine com `fetch()` nativo não controla settings frames HTTP/2.                                                                               |
| 20    | **Proof-of-Work challenges**                                      | 🟡 MÉDIO   | Sem suporte a PoW challenges (Kasada, Shape Security).                                                                                                                                |
| 35    | **Timing randomization**                                          | 🟡 MÉDIO   | Exponential backoff previsível (`2^n * 1000ms`). Sem jitter random, sem human-like variance.                                                                                          |
| 33+   | **Browser fingerprint rotation**                                  | 🟡 MÉDIO   | Viewport fixo 1920x1080, locale fixo `en-US`, timezone fixo `America/New_York`. Sem rotação entre sessões.                                                                            |
| 2     | **Meta robots / X-Robots-Tag**                                    | 🟢 BAIXO   | Não analisa `<meta name="robots">` nem header `X-Robots-Tag`.                                                                                                                         |
| 39    | **Shadow DOM content**                                            | 🟢 BAIXO   | Hero renderiza Shadow DOM via Chromium, mas `outerHTML` extraction pode perder conteúdo em shadow roots.                                                                              |
| 38    | **Content obfuscation** (CSS text)                                | 🟢 BAIXO   | Sem handling para texto via CSS `::before`/`::after`, Canvas text, SVG text.                                                                                                          |
| 30    | **Font enumeration FP**                                           | 🟢 BAIXO   | Hero emula fonts parcialmente. Sem controle granular de font list.                                                                                                                    |
| 43    | **GraphQL/REST anti-scrape**                                      | 🟢 BAIXO   | Sem controle de query complexity ou rate limit por endpoint.                                                                                                                          |

---

## 4. Scorecard

| Categoria                 | Score | Nota                                                 |
| ------------------------- | ----- | ---------------------------------------------------- |
| Infraestrutura de engines | 9/10  | Excelente cascade pattern                            |
| Cloudflare bypass         | 7/10  | JS challenges sim, Turnstile interativo/CAPTCHAs não |
| TLS fingerprinting        | 8/10  | Hero + got-scraping cobrem bem                       |
| Proxy support             | 8/10  | Rotação, residential, geo-targeting, sticky sessions |
| Anti-headless evasion     | 8/10  | Hero é top-tier                                      |
| CAPTCHA solving           | 0/10  | Nenhuma integração                                   |
| Behavioral evasion        | 1/10  | Zero simulação humana                                |
| UA management             | 2/10  | Hardcoded, desatualizado, sem rotação                |
| robots.txt control        | 3/10  | Respeita sempre, sem bypass                          |
| Agent poisoning defense   | 0/10  | Nenhuma detecção                                     |
| Enterprise WAFs           | 1/10  | Só Cloudflare                                        |
| Content interaction       | 3/10  | waitForSelector existe, sem scroll/click             |

**Score geral para "power scraping": 4.2/10**

---

## 5. Referência de Arquivos-Chave

| Arquivo                          | Responsabilidade                                                 |
| -------------------------------- | ---------------------------------------------------------------- |
| `src/engines/http/index.ts`      | Engine HTTP nativo, UA hardcoded, headers, detecção de challenge |
| `src/engines/tlsclient/index.ts` | Engine TLS com got-scraping, fingerprint de browser              |
| `src/engines/hero/index.ts`      | Engine browser completo, Cloudflare resolution                   |
| `src/engines/orchestrator.ts`    | Cascade pattern, retry por tipo de erro                          |
| `src/cloudflare/detector.ts`     | Detecção multi-sinal de challenges Cloudflare                    |
| `src/cloudflare/handler.ts`      | Resolução de challenges via polling                              |
| `src/browser/hero-config.ts`     | Config anti-detection: TLS FP, DNS over TLS, WebRTC mask         |
| `src/browser/pool.ts`            | Pool de browsers com reciclagem e health checks                  |
| `src/proxy/config.ts`            | Construção de URLs de proxy (datacenter/residential)             |
| `src/client.ts`                  | Rotação de proxies, lifecycle do HeroCore                        |
| `src/utils/robots-parser.ts`     | Parser de robots.txt                                             |
| `src/utils/rate-limiter.ts`      | Rate limiting e concurrency                                      |
| `src/scraper.ts`                 | Lógica principal, retry com backoff, check robots.txt            |
| `src/crawler.ts`                 | Crawling BFS, link extraction, rate limiting                     |
| `src/errors.ts`                  | Hierarquia de erros tipados                                      |
| `src/types.ts`                   | Tipos e DEFAULT_OPTIONS                                          |
