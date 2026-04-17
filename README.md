# WAIBOT // Neural WhatsApp Intelligence Interface v2.5

```
██╗    ██╗ █████╗ ██╗██████╗  ██████╗ ████████╗
██║    ██║██╔══██╗██║██╔══██╗██╔═══██╗╚══██╔══╝
██║ █╗ ██║███████║██║██████╔╝██║   ██║   ██║   
██║███╗██║██╔══██║██║██╔══██╗██║   ██║   ██║   
╚███╔███╔╝██║  ██║██║██████╔╝╚██████╔╝   ██║   
 ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝╚═════╝  ╚═════╝   ╚═╝   
```

**Neural WhatsApp Bot Interface** — Automatización inteligente, integración con múltiples IAs y consultas a bases de datos en tiempo real.

---

## 🚀 Inicio Rápido

### 1. Requisitos
- **Node.js** v18+
- **Chrome/Chromium** instalado (para el motor de WhatsApp)
- **Opcional:** Base de datos MySQL o PostgreSQL
- **Opcional:** API Keys de Anthropic, OpenAI o Google Gemini

### 2. Instalación
```bash
npm install
```

### 3. Configuración
```bash
cp .env.example .env
# Edita el archivo .env con tus claves o configúralas directamente desde el panel
```

### 4. Ejecución
```bash
npm start
```
Luego abre **http://localhost:3000** en tu navegador.

---

## 📖 Funciones Destacadas

### 🤖 WhatsApp Engine
- Conexión vía WhatsApp Web (Escaneo de QR)
- Respuestas automáticas dinámicas
- Control de estado (ON/OFF) desde la barra lateral
- Envío manual de mensajes directos

### 🧠 Inteligencia Artificial Avanzada
Soporta los motores de IA más potentes del mercado:
| Proveedor | Modelo Por Defecto | Notas |
|-----------|--------------------|-------|
| **Gemini** | `gemini-1.5-flash` | Alta velocidad, nivel gratuito disponible |
| **OpenAI** | `gpt-4o-mini` | Máxima precisión, muy económico |
| **Claude** | `claude-sonnet-4` | Excelente para contextos complejos |
| **Ollama** | Local (Llama3, etc.) | 100% privado, ejecución local |

### 🧬 AI Neural Simulator (Lab)
Nueva sección para probar el comportamiento del bot sin enviar mensajes reales.
- Simula usuarios específicos.
- Prueba keywords y consultas a DB.
- Botón de limpieza rápida.
- Entorno seguro para depurar la personalidad del bot.

### 💾 Persistencia de Configuración
Ahora todos tus cambios se guardan automáticamente en `config.json`:
- Personalidad del bot (Persona & Contexto)
- Selección de proveedor de IA
- API Keys y URLs de Ollama
- Selección de tablas de base de datos activas

---

## 🖥️ Paneles del Dashboard

| Panel | Descripción |
|-------|-------------|
| **Dashboard** | Métricas en tiempo real y estado general |
| **WhatsApp** | Gestión de conexión y QR |
| **Messages** | Stream en vivo de conversaciones |
| **AI Config** | Personalidad del bot y selección de IA |
| **AI Simulator** | 🧪 Entorno de pruebas y sandbox |
| **Replies** | Gestión de respuestas rápidas con imágenes |
| **Database** | Conexión SQL y mapeo de tablas |
| **Logs** | Registro completo de eventos del sistema |

---

## 🌍 Idiomas
La interfaz es **100% Multilingüe** (Español / Inglés), permitiendo cambiar el idioma del panel en tiempo real con un solo clic en la cabecera.

---

## 📁 Estructura del Proyecto

```
waibot/
├── src/                # Lógica del servidor (Express, Socket.io, Bot)
├── public/             # Interfaz Premium (HTML, CSS, JS nativo)
├── config.json         # Configuración persistente (Auto-generado)
├── replies.json        # Base de datos de respuestas rápidas
├── .env                # Variables de entorno
└── README.md           # Documentación
```

---

*Desarrollado con whatsapp-web.js, Express y tecnologías Neurales.*
