<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo/genfin-escuro.svg">
    <img src="docs/logo/genfin.svg" alt="GenFin" width="380">
  </picture>
</h1>

**Sua carteira de investimentos num arquivo só.**
Preço médio, alocação, proventos, rebalanceamento e imposto de renda para quem investe na bolsa brasileira.

![HTML único](https://img.shields.io/badge/HTML-arquivo_único-16232B?style=flat-square&logo=html5&logoColor=white)
![Zero dependências](https://img.shields.io/badge/dependências-zero-1F7A4A?style=flat-square)
![pt-BR](https://img.shields.io/badge/idioma-pt--BR-2B5C8F?style=flat-square)
![Testes](https://img.shields.io/badge/testes-node-6A4C9C?style=flat-square&logo=nodedotjs&logoColor=white)

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/resumo-escuro.png">
  <img src="docs/img/resumo.png" alt="Tela de resumo do GenFin com patrimônio, alocação por classe, evolução e maiores posições" width="900">
</picture>

<sub>Capturas feitas com os dados de exemplo do próprio app. Todos os valores e códigos são fictícios.</sub>

</div>

---

## Sumário

- [O que ele faz](#o-que-ele-faz)
- [Telas](#telas)
- [Como usar](#como-usar)
- [Onde ficam os seus dados](#onde-ficam-os-seus-dados)
- [Como os números são calculados](#como-os-números-são-calculados)
- [Imposto de renda](#imposto-de-renda)
- [Desenvolvimento](#desenvolvimento)
- [Próximos passos](#próximos-passos)
- [Aviso](#aviso)

## O que ele faz

| | |
|---|---|
| 📊 **Resumo** | Patrimônio, valorização em aberto, lucro realizado, proventos e resultado sobre o total aportado. Alocação atual comparada com a meta, gráfico de evolução e comparação com o CDI e o Ibovespa. |
| 💹 **Ativos e cotações** | Posição por classe com quantidade, preço médio, valor de mercado, resultado e peso na carteira. Cotações automáticas de ações, ETFs, FIIs e cripto; renda fixa e correções, à mão. |
| 🧾 **Lançamentos** | Compras e vendas com taxas da nota de corretagem. Aplicações e resgates de renda fixa. Editar e excluir, sempre impedindo vendas maiores que o saldo, inclusive em datas retroativas. |
| 💰 **Proventos** | Dividendos, JCP e rendimentos de FIIs, com gráfico dos últimos 12 meses e rendimento sobre o custo por ativo. |
| ⚖️ **Rebalancear** | Metas por classe e sugestão de como dividir um novo aporte para se aproximar delas, só com compras. |
| 🦁 **Imposto de renda** | Apuração mensal com isenções, compensação de prejuízo e DARF; bens e direitos em 31/12; proventos do ano separados por tipo. |
| 📰 **Notícias** | Atalhos para o Google Notícias e o Status Invest de cada ativo. |

Cinco classes de ativo: **ações**, **ETFs**, **FIIs**, **renda fixa** e **cripto**.

## Telas

<table>
  <tr>
    <td width="50%"><img src="docs/img/ativos.png" alt="Ativos e cotações"><p align="center"><sub>Ativos e cotações</sub></p></td>
    <td width="50%"><img src="docs/img/proventos.png" alt="Proventos"><p align="center"><sub>Proventos</sub></p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/img/rebalancear.png" alt="Rebalancear"><p align="center"><sub>Rebalancear</sub></p></td>
    <td width="50%"><img src="docs/img/ir.png" alt="Imposto de renda"><p align="center"><sub>Imposto de renda</sub></p></td>
  </tr>
</table>

<p align="center">
  <img src="docs/img/celular.png" alt="Resumo no celular" width="280"><br>
  <sub>No celular, com tema claro e escuro automáticos</sub>
</p>

## Como usar

Não há instalação nem build. O app inteiro é o [`carteira.html`](carteira.html).

1. Abra o `carteira.html` no navegador.
2. Clique em **Ver com dados de exemplo** para conhecer as telas sem registrar nada, ou em **Adicionar lançamento** para começar a sua carteira.
3. Para cotações automáticas de ações, ETFs e FIIs, crie uma chave gratuita na [brapi.dev](https://brapi.dev) e cole na aba **Ativos e cotações**. Cripto funciona sem chave.

### No celular

O GenFin é um app instalável (PWA): funciona sem internet e abre como app, sem barra do navegador. Ele fica hospedado de graça na Vercel, ligado a este repositório, e cada `git push` publica a versão nova.

1. Na [Vercel](https://vercel.com), entre com a conta do GitHub, clique em **Add New → Project** e importe o repositório **GenFin**. Não há build: deixe o *Framework Preset* em **Other** e clique em **Deploy**.
2. Abra o endereço que a Vercel mostrar (algo como `genfin.vercel.app`) no celular.
   - **Android (Chrome):** menu ⋮ → **Instalar app**.
   - **iPhone (Safari):** botão de compartilhar → **Adicionar à Tela de Início**.
3. Cada aparelho guarda os próprios dados. Para levar a carteira do computador para o celular, use **Backup → Exportar backup** num e **Restaurar backup** no outro. A chave da brapi não vai no backup: cole de novo no celular.

O `.vercelignore` publica só o app (página, manifesto, service worker e ícones). O endereço é público, mas não aparece em buscadores e não contém dados: a carteira fica no navegador de quem usa.

### Comparação com CDI e Ibovespa

O resumo mostra quanto a carteira teria hoje se **os mesmos aportes, vendas e proventos, nas mesmas datas**, tivessem ido para o CDI ou para o Ibovespa. Assim o resultado não depende de quando você colocou dinheiro.

- **CDI:** série diária do Banco Central (pública, sem chave), com a linha pontilhada no gráfico de evolução.
- **Ibovespa:** histórico da brapi, com a mesma chave das cotações. O plano gratuito cobre poucos meses; o app guarda os dias e o histórico cresce com o uso. Enquanto não cobre desde o primeiro aporte, o valor aparece como aproximado.
- Não considera imposto nem taxas do investimento comparado.

### Cotações automáticas

| Classe | Fonte | Chave | Atualização |
|---|---|---|---|
| Ações, ETFs e FIIs | [brapi.dev](https://brapi.dev) | Gratuita, 15 mil consultas por mês | Dados a cada 30 minutos |
| Cripto | [Mercado Bitcoin](https://www.mercadobitcoin.com.br) | Não precisa | Último negócio em reais |
| Renda fixa | Você digita o valor atual do título | — | — |

- O app busca sozinho ao abrir, no máximo a cada 30 minutos, e há um botão **Atualizar cotações**.
- No plano gratuito, a brapi responde um ativo por consulta; o app faz quatro de cada vez.
- Ações fracionárias (como `ITSA4F`) usam a cotação do lote (`ITSA4`).
- O que não for encontrado continua com a última cotação, ou pelo preço médio, e aparece na mensagem da busca.

O app também roda como **Artifact no claude.ai**. Lá ele usa o login e o banco de dados da conta para guardar os dados e sincronizar entre aparelhos.

## Onde ficam os seus dados

```mermaid
flowchart LR
    A[Você registra<br>lançamentos, proventos,<br>cotações e metas] --> S[(Estado da carteira)]
    S --> L[localStorage<br>do navegador]
    S -. quando roda<br>no claude.ai .-> C[(Banco da conta<br>4 documentos por usuário)]
    S --> B[Backup<br>.json / .csv]
```

- **Sempre no navegador**, na chave `carteira-v1` do `localStorage`. Fora do claude.ai, a carteira não sai do seu computador. Para as cotações, só os **códigos** dos ativos (como `PETR4` ou `BTC`) vão para a brapi e o Mercado Bitcoin; quantidades e valores nunca são enviados.
- **A chave da brapi** fica só no navegador, separada da carteira. Ela não entra no backup nem vai para a conta.
- **No claude.ai**, também na conta do usuário, em quatro documentos (`carteira`, `lancamentos`, `proventos` e `historico`). Cada salvamento leva data e hora. Ao abrir, o lado mais recente vence, para não perder alterações feitas sem conexão.
- **Backup:** o botão no topo exporta tudo em `.json`, exporta os lançamentos em `.csv` e restaura um backup. Os arquivos exportados estão no `.gitignore`, para não irem parar no repositório por engano.

## Como os números são calculados

Toda a carteira é recalculada a partir dos lançamentos, em ordem de data, pela função `calcular()`.

- **Preço médio:** o custo das compras, taxas incluídas, dividido pela quantidade. Vendas não mudam o preço médio; elas baixam o custo proporcional e geram lucro ou prejuízo realizado.
- **Renda fixa:** cada título vale pelo valor total informado (como aparece na corretora). Um resgate baixa o custo na mesma proporção do valor resgatado.
- **Resultado sobre o total aportado:** (valorização em aberto + lucro realizado + proventos) ÷ tudo o que já foi aplicado.
- **Evolução:** o patrimônio do dia é guardado sempre que você lança algo ou atualiza uma cotação.

## Imposto de renda

Operações comuns de pessoa física, sem day trade:

| Classe | Alíquota | Isenção | Compensação de prejuízo | DARF |
|---|---|---|---|---|
| Ações | 15% | Vendas de até R$ 20 mil no mês | Com ações e ETFs | 6015 |
| ETFs | 15% | Nenhuma | Com ações e ETFs | 6015 |
| FIIs | 20% | Nenhuma | Só com FIIs | 6015 |
| Cripto | 15% a 22,5%, por faixa de ganho | Vendas de até R$ 35 mil no mês | — | 4600 |

- DARF abaixo de R$ 10 acumula para o mês seguinte. O vencimento é o último dia útil do mês seguinte, sem considerar feriados.
- **Bens e direitos** saem pelo custo de aquisição em 31/12 de cada ano, com o grupo e o código da declaração.
- **Dividendos a partir de 2026 (Lei 15.270/2025):** o app avisa quando uma empresa pagou mais de R$ 50 mil em um mês, caso em que há 10% de IR retido na fonte.
- O IR retido na fonte (o "dedo-duro") não é descontado.

> [!IMPORTANT]
> É uma estimativa para conferência. Compare sempre com as notas de corretagem e com o informe de rendimentos e, na dúvida, fale com um contador.

## Desenvolvimento

```
.
├── carteira.html          # o app inteiro: HTML, CSS e JavaScript
├── manifest.webmanifest   # app instalável: nome, cores e ícones
├── sw.js                  # service worker: abre sem internet
├── icons/                 # ícones PNG do app instalado
├── vercel.json            # rota / → carteira.html e cabeçalhos
├── tests/
│   └── carteira.test.js   # testes da lógica, com um DOM falso
├── scripts/
│   ├── capturas.sh        # gera as imagens de docs/img
│   ├── icones.sh          # gera os PNGs de icons/
│   └── logo.js            # gera os SVGs de docs/logo
└── docs/
    ├── img/               # capturas usadas neste README
    └── logo/              # logo, ícone e prévia social
```

Os testes rodam no Node 18 ou mais recente, sem instalar nada:

```bash
npm test
```

Eles cobrem a validação de saldo (vendas e resgates retroativos, exclusão de compras), a sincronização entre o navegador e a conta, o aviso de dividendos acima de R$ 50 mil e as cotações automáticas, com as APIs simuladas (chave recusada, ativo inexistente, falta de rede e modo exemplo), a edição de lançamentos e o download do backup.

Para regenerar as capturas depois de mudar a interface (precisa do Chrome ou do Edge instalado):

```bash
npm run capturas
```

Para regenerar o logo, o ícone e o favicon embutido no app (baixa a fonte do Google Fonts na primeira vez):

```bash
npm install
npm run logo
```

## Identidade visual

<img src="docs/logo/icone.svg" alt="Ícone do GenFin" width="72" align="right">

O ícone é a **faixa de alocação**, a barra que abre o resumo do app, com o G vazado por cima. As cinco cores são as das classes (ações, ETFs, FIIs, renda fixa e cripto), separadas pela mesma fresta fina da barra. Toda a cor fica no ícone; o nome ao lado vai numa cor só, a da tinta do app, e no app troca sozinho no modo escuro.

| Arquivo | Uso |
|---|---|
| [`docs/logo/genfin.svg`](docs/logo/genfin.svg) | Logo para fundo claro |
| [`docs/logo/genfin-escuro.svg`](docs/logo/genfin-escuro.svg) | Logo para fundo escuro |
| [`docs/logo/icone.svg`](docs/logo/icone.svg) | Ícone e favicon |
| [`docs/logo/social.png`](docs/logo/social.png) | Prévia de link (1280×640) |

Fonte: [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque) 800, convertida em contornos por [`scripts/logo.js`](scripts/logo.js).

## Próximos passos

- [x] Cotações automáticas (brapi.dev para a B3, Mercado Bitcoin para cripto), mantendo a digitação manual
- [x] Editar lançamentos, não só excluir
- [x] Download real do backup fora do claude.ai
- [x] App instalável no celular (PWA na Vercel)

## Aviso

O GenFin é uma ferramenta de organização e cálculo. Não é recomendação de investimento, e as estimativas de imposto não substituem a orientação de um profissional.
