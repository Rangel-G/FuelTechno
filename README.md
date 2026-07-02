# 🚗 FuelTechno

> Uma plataforma de telemetria automotiva inspirada na FuelTech, desenvolvida para veículos com ECU original através da comunicação OBD-II.

![Python](https://img.shields.io/badge/Python-3.11+-blue?logo=python)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6-yellow?logo=javascript)
![Bluetooth](https://img.shields.io/badge/Bluetooth-BLE-blue?logo=bluetooth)
![OBD-II](https://img.shields.io/badge/OBD--II-ELM327-red)
![License](https://img.shields.io/badge/Status-Em%20Desenvolvimento-orange)

---

# 📖 Sobre

O **FuelTechno** é um projeto open source que busca reproduzir parte da experiência oferecida por uma ECU programável como a **FuelTech**, porém utilizando inicialmente a ECU original do veículo.

A aplicação permite visualizar informações do motor em tempo real através de um painel moderno, utilizando comunicação com adaptadores **OBD-II ELM327**, além de integrar dispositivos Bluetooth Low Energy, como fitas LED RGB sincronizadas com o funcionamento do veículo.

O objetivo do projeto é evoluir para uma plataforma completa de telemetria automotiva, oferecendo recursos de monitoramento, personalização e análise de dados.

---

# ✨ Funcionalidades

Atualmente o projeto possui:

- ✅ Comunicação com adaptadores OBD-II (ELM327)
- ✅ Leitura de parâmetros do veículo em tempo real
- ✅ Interface inspirada na FuelTech
- ✅ Painéis personalizados
- ✅ Sistema de Mapas
- ✅ Bancada Manual para simulação dos sensores
- ✅ Comunicação Bluetooth Low Energy
- ✅ Controle de fita LED RGB
- ✅ Shift Light baseado no RPM
- ✅ Configuração através de arquivo `.env`
- ✅ Arquitetura modular

---

# 🖥️ Interface

O sistema possui diferentes telas para facilitar a utilização.

- Dashboard Principal
- Painel Diário
- Seleção de Mapas
- Configurações
- Data Logger (em desenvolvimento)

---

# 📂 Estrutura do Projeto

```text
FuelTechno/
│
├── backend/
│   ├── bridge.py
│   ├── led_controller.py
│   ├── config.py
│   └── ...
│
├── frontend/
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── pages/
│   └── assets/
│
├── .env.example
├── requirements.txt
└── README.md
```

---

# 🚀 Instalação

## 1. Clone o repositório

```bash
git clone https://github.com/SEU-USUARIO/FuelTechno.git
```

Entre na pasta:

```bash
cd FuelTechno
```

---

## 2. Crie um ambiente virtual

### Windows

```bash
python -m venv .venv

.venv\Scripts\activate
```

### Linux / macOS

```bash
python3 -m venv .venv

source .venv/bin/activate
```

---

## 3. Instale as dependências

```bash
pip install -r requirements.txt
```

---

## 4. Configure o arquivo .env

Copie o arquivo de exemplo.

### Windows

```bash
copy .env.example .env
```

### Linux

```bash
cp .env.example .env
```

Depois configure conforme seu ambiente.

Exemplo:

```env
SERIAL_PORT=COM4
BAUD_RATE=115200

LED_DEVICE_NAME=LEDDM5-000101

WS_HOST=localhost
WS_PORT=8765
```

---

# ▶️ Executando

Primeiro inicie a Bridge responsável pela comunicação OBD.

```bash
python bridge.py
```

Depois abra a interface utilizando um servidor HTTP.

Exemplo:

```bash
python -m http.server
```

Acesse:

```
http://localhost:8000
```

---

# 🔧 Tecnologias

O projeto utiliza:

- Python
- JavaScript
- HTML5
- CSS3
- WebSocket
- PySerial
- Bleak
- Bluetooth Low Energy
- OBD-II
- ELM327

---

# 📡 Comunicação

```text
          Adaptador OBD-II
                 │
                 │
          Python Bridge
                 │
          WebSocket Server
                 │
         Frontend (Dashboard)
                 │
        Bluetooth Low Energy
                 │
            Fita LED RGB
```

---

# 📊 Recursos atuais

## Dashboard

- RPM
- Velocidade
- Temperatura
- MAP
- Pressão
- Indicadores
- Shift Light

## Bancada Manual

Permite simular sensores sem conectar ao veículo.

Ideal para desenvolvimento da interface.

---

# 🛣️ Roadmap

Planejado para as próximas versões:

- [ ] Data Logger completo
- [ ] Exportação CSV
- [ ] Replay da telemetria
- [ ] Alertas configuráveis
- [ ] Dashboard totalmente personalizável
- [ ] Temas
- [ ] Sistema de Plugins
- [ ] Escrita de parâmetros via OBD-II (quando suportado)
- [ ] HUD
- [ ] Estatísticas de condução
- [ ] Aplicativo Mobile

---

# 🤝 Contribuindo

Contribuições são muito bem-vindas.

Caso encontre algum problema ou tenha sugestões:

1. Faça um Fork
2. Crie uma Branch
3. Realize suas alterações
4. Abra um Pull Request

---

# ⚠️ Aviso

Este projeto **não substitui uma ECU programável**.

Atualmente o foco está em:

- Monitoramento
- Telemetria
- Interface
- Comunicação OBD-II
- Integração Bluetooth

Qualquer funcionalidade de escrita dependerá do suporte da ECU original do veículo.

---

# 📜 Licença

Este projeto é distribuído sob a licença MIT.

---

# 👨‍💻 Autor

Desenvolvido por **João Vitor Rangel de Godoy**

Inspirado na tecnologia das ECUs programáveis FuelTech e desenvolvido com foco em aprendizado, telemetria automotiva e software open source.
