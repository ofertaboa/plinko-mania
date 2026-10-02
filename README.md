# Plinko Mania — espelho 100% estático

Espelho completo do site **https://plinkopremiado.online/** (Plinko Mania): HTML, JS, CSS,
imagens, ícones, áudios, vídeos, API de configuração e a página `404.html` — tudo local,
sem dependência de um servidor de aplicação.

> **Base path.** O repositório está configurado para o **GitHub Pages de projeto**:
> tudo é publicado em **`/plinko-mania/`** (`https://ofertaboa.github.io/plinko-mania/`).
> Para Netlify, Cloudflare Pages ou domínio próprio (raiz), rode antes:
> `node tools\rebase.js --root` — veja [Base path](#base-path--caminho-de-publicação).

---

## Rodar localmente

Precisa de um servidor HTTP (abrir o `index.html` com `file://` não funciona, porque todos
os caminhos são absolutos: `/_next/...`, `/images/...`).

```
INICIAR-LOCAL.bat          ← sobe em http://localhost:8080 e abre o navegador
```

URL local: **http://localhost:8080/plinko-mania/** (o servidor redireciona `/` para lá).

ou manualmente:

```
node tools\server.js                # porta 8080 (PORT=3000 para trocar)
npx serve .                         # alternativa
python -m http.server 8080          # alternativa (sem Range/MP4)
```

O `tools/server.js` entrega `Content-Type` correto (inclusive `application/json` para
`/api/*`), suporta **Range** para os vídeos, redireciona para o base path e devolve
`404.html` para rotas inexistentes.

---

## Deploy

### GitHub Pages (já configurado)

* Settings → Pages: **Deploy from a branch**, branch `main`, pasta `/ (root)`.
* `.nojekyll` desativa o Jekyll (senão ele ignoraria `_next/` e `api/`).
* Pronto: https://ofertaboa.github.io/plinko-mania/

### Netlify / Cloudflare Pages (raiz)

**Rode antes `node tools\rebase.js --root`** — senão todos os links apontam para
`/plinko-mania/...`, que não existe nesses hosts.

```
node tools\rebase.js --root        # remove o base path (publica na raiz)
node tools\rebase.js               # volta a aplicar /plinko-mania

# Netlify:  arraste a pasta em https://app.netlify.com/drop  (netlify.toml pronto)
# Cloudflare Pages:  npx wrangler pages deploy .             (wrangler.toml pronto)
```

### O que cada host resolve automaticamente

| Caminho (sob o base path)        | Resultado                                            |
|----------------------------------|------------------------------------------------------|
| `/plinko-mania/`, `/plinko-mania/jogar`, ... (18 rotas) | arquivo real `rota/index.html` |
| `/plinko-mania/rota-inexistente` | `404.html` (botão **Acessar agora** → `/plinko-mania/`) |
| `/plinko-mania/api/v1/platform/config` | stub local de configuração                     |

`_redirects` fica **intencionalmente sem catch-all**: um `/* /404.html 404` poderia
"sombrear" arquivos reais (`/api/*`, `/_next/*`). Netlify, Cloudflare Pages e GitHub
Pages já servem o `404.html` sozinhos.

---

## Rotas (18)

Todas as rotas são relativas ao base path (`/plinko-mania` abaixo):

```
/plinko-mania/            /plinko-mania/cadastrar     /plinko-mania/depositar
/plinko-mania/entrar      /plinko-mania/extrato       /plinko-mania/indique
/plinko-mania/jogar       /plinko-mania/jogo-responsavel                /plinko-mania/missoes
/plinko-mania/perfil      /plinko-mania/premios      /plinko-mania/privacidade
/plinko-mania/sacar       /plinko-mania/salas        /plinko-mania/seguranca
/plinko-mania/sobre       /plinko-mania/suporte      /plinko-mania/termos
```

Rotas autenticadas (`/perfil`, `/depositar`, `/sacar`, `/extrato`, `/missoes`, `/premios`,
`/indique`, `/seguranca`) redirecionam para `/entrar` quando não há sessão — comportamento
idêntico ao site original (feito pelo próprio bundle).

---

## Base path — caminho de publicação

O base path fica em **`tools/base.js`** (hoje: `/plinko-mania`).

| Host                              | Base path    | Como ficar pronto                |
|-----------------------------------|--------------|----------------------------------|
| GitHub Pages de projeto (este repo) | `/plinko-mania` | **já configurado**           |
| Netlify, Cloudflare Pages, VPS, domínio próprio | `""` (raiz) | `node tools\rebase.js --root` |

`tools/rebase.js` reescreve **todos** os caminhos absolutos (HTML, payload RSC, JS, CSS,
`manifest.webmanifest`, `sw.js` e os stubs em `api/`), aplicando o prefixo. É idempotente:
sempre remove o base atual e reaplica o desejado.

```
node tools\rebase.js            # aplica o base de tools\base.js (/plinko-mania)
node tools\rebase.js --root     # remove o base (publica na raiz)
node tools\rebase.js /meu-app   # usa outro prefixo
node tools\rebase.js --dry      # só mostra o que mudaria
```

**Nunca edite os caminhos na mão** — use sempre o `rebase.js`.

---

## Como foi montado (`tools/`)

| Script               | Função |
|----------------------|--------|
| `mirror.js`          | rastreia as 18 rotas e baixa HTML + assets referenciados |
| `dynamic.js`         | captura requisições em runtime (netlog do Chrome) e baixa o que faltou (chunks dinâmicos, avatares) |
| `patch.js`           | aplica os 3 patches abaixo e valida sintaxe (`node --check`) |
| `extract-config.js`  | extrai o objeto de config padrão injetado pelo bundle |
| `base.js`            | base path atual (`/plinko-mania`) |
| `rebase.js`          | aplica/remove o base path em HTML, payload RSC, JS, CSS, JSON |
| `server.js`          | servidor local (MIME, Range, 404, base path) |
| `check.js`           | auditoria: assets referenciados × disco, rotas 200, 404, URLs externas |
| `headless.js`        | smoke test: carrega as 18 rotas e falha se houver erro de console |
| `compare.js`         | compara o texto renderizado origem × espelho (requer `puppeteer-core`) |

Re-rodar a auditoria:

```
node tools\server.js & node tools\check.js && node tools\headless.js
```

### Patches aplicados pelo `patch.js` (idempotentes)

1. **`/_next/image` loader** (`_next/static/chunks/1z_0243anyqhu.js`): o bundle original
   monta `` `/_next/image?url=...` `` — sem o handler de imagens do Next esse caminho
   responderia 404. O patch faz `return r` (usa a URL original já otimizada).
   ⚠️ Trocar `unoptimized:!1` por `unoptimized:!0` **quebra** o app (erro de hidratação
   React #418) — por isso o patch é no loader.
2. **`runtimeApiUrl`** (mesmo chunk): em `localhost` devolvia
   `http://localhost:16180` (erro `ERR_CONNECTION_REFUSED`) e fora do domínio de produção
   montava `https://api.<host>` (inexistente). Agora devolve `""` (mesmo domínio) — ou a API
   real quando o hostname é `plinkopremiado.online`.
3. **`404.html`**: página própria com **Acessar agora** (home) e **Ir para Jogar** no tema
   do site (`#050408`/`#702468`). Os links são reescritos pelo `rebase.js`.

### Stubs de API (mesmo domínio)

A API real (`https://api.plinkopremiado.online`) só permite CORS do próprio
`plinkopremiado.online` — de qualquer outro host as chamadas seriam bloqueadas. Por isso o
espelho serve localmente o que o app pede no carregamento:

| Arquivo                    | Conteúdo |
|----------------------------|----------|
| `api/v1/platform/config`   | config completa (salas, prêmios, banners, caminhos de imagem) |
| `api/v1/games/winners`     | snapshot real da lista de ganhadores |
| `api/v1/tracking/config`   | `metaEnabled:false, googleEnabled:false` (nada de scripts de terceiros) |

Quando o hostname é `plinkopremiado.online`, `runtimeApiUrl` continua apontando para a API
real e o site funciona com backend de verdade.

---

## Limitações do espelho

* **Login/cadastro/depósito/saque não funcionam** fora do domínio de produção: não há backend.
* A lista de ganhadores e os valores são um **snapshot** (dados reais da API no momento do
  download), não ao vivo.
* Os três erros de console `net::ERR_CONNECTION_REFUSED .../api/v1/...` **desaparecem**
  quando o host serve os stubs acima.
* URLs `https://www.googletagmanager.com/...` só existem dentro do bundle; elas **não** são
  carregadas porque `tracking/config` vem desabilitado. As três URLs `https://a@b`,
  `https://a#б`, `https://тест` são vetores de teste de uma biblioteca de URL (nunca
  são usadas em rede).
* Não há VSL/HLS no site original: os únicos vídeos são
  `videos/home-banner-1.mp4` e `videos/home-banner-2.mp4` (ambos baixados). Áudios:
  `images/sounds/plinko-music.mp3`, `plinko-land.wav`, `plinko-ball.wav`.

---

## Números

* **13,3 MB / 182 arquivos** — 18 rotas, 86 assets citados pela config, 12 avatares SVG,
  3 sons, 2 vídeos, chunks `_next` dinâmicos.
* Todos os testes rodam **com o base path `/plinko-mania`** (mesmo caminho do GitHub Pages):
  * Auditoria (`tools/check.js`): **0 falhas** — 18 rotas 200, 404 OK, 135 assets faltando: 0.
  * Smoke test (`tools/headless.js`): **18/18 rotas**, 0 erros de console, 0 imagens quebradas.
  * Navegação por clique: **12/12** links levam à rota certa (sem erro).
  * `404.html`: status 404, botão **Acessar agora** leva à home, 0 erros.
  * Desktop 1280 e mobile 390: **0 falhas**.
