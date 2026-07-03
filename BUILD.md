# Como gerar o FuelTechno.exe (Windows)

Depois disso, você **nunca mais precisa abrir o CMD** para usar o app.
Só dar duplo-clique no `.exe`.

## 1. Onde colocar os arquivos novos/atualizados

Substitua/adicione estes arquivos na raiz do seu projeto (mesma pasta do
`bridge.py`, `config.py`, `led_controller.py`, `index.html`, etc):

```
FuelTechno/
├── main.py              <- NOVO (ponto de entrada único)
├── bridge.py             <- ATUALIZADO (conexão OBD manual)
├── app.js                <- ATUALIZADO (botão Ligar/Desligar)
├── pages/
│   └── ajustes.html       <- ATUALIZADO (botão Ligar/Desligar)
├── style.css              <- adicione o conteúdo de style_addon.css no final
├── requirements.txt        <- ATUALIZADO (+ pywebview)
├── config.py               (sem alteração)
├── led_controller.py       (sem alteração)
├── index.html               (sem alteração)
└── .env                      (sua configuração local)
```

## 2. Instale as dependências (uma única vez)

```bash
python -m venv .venv
.venv\Scripts\activate

pip install -r requirements.txt
pip install pyinstaller
```

## 3. Teste antes de compilar

Rode assim para garantir que está tudo certo antes de gerar o .exe:

```bash
python main.py
```

Uma janela deve abrir sozinha com a interface do FuelTechno. Vá em
**Ajustes → Configurar Conexão → Ligar Conexão** e veja se o backend tenta
abrir a porta serial (acompanhe o terminal, que nesse momento ainda está
visível porque você rodou via `python`).

## 4. Compile o executável único

Rode este comando na raiz do projeto (Windows, PowerShell ou CMD):

```bash
pyinstaller --onefile --windowed --name FuelTechno \
  --add-data "index.html;." \
  --add-data "style.css;." \
  --add-data "app.js;." \
  --add-data "pages;pages" \
  main.py
```

> Observação: no Windows o separador do `--add-data` é `;`. Se um dia
> compilar em Linux/Mac, troque por `:`.

Isso vai gerar:

```
dist/FuelTechno.exe
```

Esse é o único arquivo que você (ou qualquer pessoa) precisa para rodar o
app — sem Python instalado, sem CMD, sem `pip install`.

> Se o `.env` não existir na mesma pasta do `.exe`, o `config.py` cai nos
> valores padrão. Recomendo copiar seu `.env` para dentro de `dist/` junto
> com o `FuelTechno.exe`, ou criar um instalador simples depois que
> também copie esse arquivo.

## 5. Rodando o app pronto

1. Copie `dist/FuelTechno.exe` (e o `.env`, se quiser preservar suas
   configurações) para onde quiser.
2. Dê duplo-clique.
3. Uma janela abre com a interface — já com o WebSocket e o backend
   rodando por trás, sem CMD nenhum aparecendo.
4. Vá em **Ajustes** e clique em **Ligar Conexão** para abrir a porta
   serial e começar a receber dados do veículo (ou **Desligar Conexão**
   para parar, sem fechar o app).

## Observações importantes

- **WebView2 Runtime**: o `pywebview` no Windows usa o WebView2 (baseado
  no Chromium/Edge). Ele já vem pré-instalado no Windows 10 (a partir de
  meados de 2021) e no Windows 11. Se a janela não abrir em um PC muito
  antigo, baixe o "WebView2 Runtime" no site da Microsoft.
- **Antivírus/SmartScreen**: executáveis gerados com PyInstaller às vezes
  são sinalizados por antivírus por serem novos/não assinados. Isso é
  normal em builds caseiras; se for distribuir para terceiros, considere
  assinar o executável digitalmente no futuro.
- **Bluetooth (bleak)**: a fita de LED continua conectando em background
  normalmente, do mesmo jeito que já funcionava — isso não mudou.
- Se quiser voltar a rodar em modo desenvolvimento (sem gerar .exe toda
  hora), `python main.py` já reproduz o comportamento final do
  executável.
