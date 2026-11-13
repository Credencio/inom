# Portal de Monitoria de Mangal e Ervas Marinhas de Moçambique

Site estático (HTML + JavaScript, sem servidor) para publicar no **GitHub Pages**. Lê directamente os Feature Services das fichas Survey123 e mostra os resultados num dashboard bilingue (PT/EN).

## Abas do portal

| Aba | O que tem |
|---|---|
| **Sobre** | Texto de apresentação (editável na Gestão). |
| **Dashboard** | 8 páginas: Visão geral, Degradação, Restauração, Monitoria, Viveiros, Levantamento ecológico, Ervas marinhas e Sobre os dados. Inclui filtros (província, distrito, posto, ano, instituição), filtro cruzado (clicar num gráfico filtra os outros), relatório em PDF e descarregamento de dados brutos e analisados. |
| **Documentos** | Relatórios e guias (carregados na Gestão). |
| **Fichas de campo** | Descarregamento das fichas XLSForm (pasta `fichas/`). |
| **Área técnica** | Validação de dados (erros e avisos por registo, exportação CSV, botão para editar no Survey123) e estado das fontes. |
| **Gestão do portal** | Editor gráfico de tudo o que está acima, sem programar. Entra-se com um token do GitHub. |

## 1. Publicar no GitHub Pages (uma vez)

1. Crie um repositório no GitHub (por exemplo `portal-mangal`) e carregue **todo o conteúdo desta pasta** para a raiz do repositório (pode arrastar os ficheiros em *Add file › Upload files*).
2. No repositório: *Settings › Pages › Build and deployment › Source: Deploy from a branch*, escolha o ramo `main` e a pasta `/ (root)`. Guarde.
3. Ao fim de 1 a 2 minutos o portal fica em `https://<conta>.github.io/portal-mangal/`.

Enquanto as fontes não estiverem configuradas, o portal mostra **dados de demonstração** (fictícios), com um aviso no topo.

## Abrir no computador (para testar antes de publicar)

Abrir o `index.html` com duplo clique **não funciona**: o navegador bloqueia a leitura dos ficheiros de configuração quando a página é aberta como ficheiro (`file://`). Use um servidor local:

- **Com Python** (Windows, Mac ou Linux): abra uma janela de comandos na pasta do portal e escreva `python -m http.server 8000`. Depois abra `http://localhost:8000` no navegador.
- **Com o Visual Studio Code**: instale a extensão *Live Server*, abra a pasta e clique em *Go Live*.

É preciso **ligação à internet**: as bibliotecas dos gráficos, do mapa e do PDF, e os dados do ArcGIS Online, vêm da internet.

## 2. Ligar os dados reais (Feature Services)

1. No ArcGIS Online, para cada camada das fichas, crie uma **vista** (*Create View Layer*), retire os campos pessoais (nome, e-mail e telefone de quem preencheu) e **partilhe a vista publicamente**. O portal é um site público: só lê camadas públicas.
2. No portal, abra **Gestão do portal › Fontes de dados**, cole o URL de cada vista (termina em `/FeatureServer`) e clique em **Testar ligação**.
3. Opcional: cole o *ID do formulário Survey123* de cada ficha, para a Área técnica mostrar o botão **Editar** em cada problema.
4. Desligue **Usar dados de demonstração** e clique em **Guardar e publicar**.

## 3. Entrar na Gestão (token do GitHub)

1. GitHub › *Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate new token*.
2. *Repository access*: escolha **só** o repositório do portal. *Permissions › Contents*: **Read and write**. Defina uma data de expiração.
3. No portal, abra **Gestão do portal**, confirme a conta e o repositório e cole o token.

O token fica guardado apenas no separador do navegador (é apagado ao fechá-lo) e nunca é gravado no repositório. Cada gravação cria um *commit* no repositório, por isso todas as alterações ficam registadas e podem ser revertidas no GitHub.

## 4. O que se pode alterar na Gestão

- Nome, subtítulo, cores, **logótipo do InOM** (cabeçalho e PDF) e **logótipo da LIKULU** (rodapé). Os logótipos incluídos são marcadores: substitua-os pelos ficheiros oficiais.
- Texto da página Sobre (PT e EN).
- Documentos e fichas de campo (carregar ficheiros ou colar ligações).
- Fontes de dados, campo usado para o filtro de ano e campos de instituições.
- Dashboard: páginas, indicadores e gráficos (título, tipo, campos, cálculo, ordem, largura). Há uma opção *Avançado (JSON)* para gráficos com várias séries.
- Regras de validação, campos excluídos dos descarregamentos e cópia de segurança da configuração.

Toda a configuração fica em `config/portal.json`.

## 5. Quando uma ficha mudar

Os nomes dos campos e das opções vêm das fichas em `fichas/`. Depois de alterar uma ficha:

1. Substitua o ficheiro `.xlsx` em `fichas/` (pode ser pela Gestão › Fichas de campo).
2. Num computador com Python e `openpyxl`, corra `python tools/extrair_esquema.py` e carregue para o repositório os ficheiros `config/schema.json` e `config/choices.json` actualizados.

As traduções para inglês das opções estão em `tools/rotulos_en.json`.

## Notas técnicas

- Bibliotecas carregadas de `cdn.jsdelivr.net`: ECharts (gráficos), Leaflet (mapa), jsPDF (relatório), SheetJS (Excel), JSZip e Marked.
- Cada repetição (*repeat*) das fichas é lida como tabela relacionada e ligada pelo `parentglobalid`.
- A Monitoria herda a província, o distrito e as instituições da área de restauração escolhida (`id_area_restauracao`).
- A área (ha) é calculada a partir dos polígonos desenhados nas fichas.
- Esconder a Área técnica com login não protege os dados: a protecção está na partilha das camadas no ArcGIS Online.
