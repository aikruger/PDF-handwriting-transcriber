# Obsidian PDF Transcriber Plugin

This is a plugin for [Obsidian](https://obsidian.md) that uses AI Vision models to transcribe handwritten notes, diagrams, and text directly from PDFs and image files into your Obsidian notes.

It supports using either **OpenAI**'s powerful cloud vision models (like GPT-4o) or **Ollama**'s local vision models (like LLaVA) for privacy-conscious, entirely offline processing.

## Features

- **Transcribe Handwritten Notes:** Accurately extract handwritten text from scanned PDFs or individual images.
- **Diagram Extraction:** Automatically detect drawings or diagrams and convert them into native Obsidian Mermaid diagrams.
- **Multiple Content Modes:**
  - **Text Only:** Optimized for extracting pure text.
  - **Diagrams Only:** Optimized for extracting structural flowcharts, diagrams, and drawings to Mermaid syntax.
  - **Mixed Mode:** Processes pages to extract both text and inline Mermaid diagrams, maintaining context.
- **Provider Choice:**
  - **OpenAI:** Uses standard OpenAI vision APIs (Requires API Key). Recommends and evaluates models.
  - **Ollama (Local):** Run models entirely on your own machine (Requires a local Ollama instance). It even evaluates and ranks local models.
- **Batch Processing:** Allows for paginated transcription of large PDFs.
- **Custom Prompts:** Tweak the instructions sent to the AI for highly customized outputs.

## Setup and Configuration

### 1. Installation

*Community Plugin installation (Coming Soon)*

**Manual Installation:**
1. Download the latest release from the GitHub releases page.
2. Extract the `main.js`, `manifest.json`, and `styles.css` into your vault at `YourVaultFolder/.obsidian/plugins/obsidian-pdf-handwriting-transcriber/`.
3. Restart Obsidian and enable the plugin from `Settings > Community Plugins`.

### 2. Provider Configuration

Go to `Settings > PDF Transcriber` and choose your preferred Active Provider.

#### Using OpenAI (Cloud)
1. Select "OpenAI" as the active provider.
2. Enter your OpenAI API Key.
3. Click "Test Connection" to ensure it's working.
4. Click "Refresh & Recommend" to fetch the latest available models (e.g., `gpt-4o`).
5. Select the model from the dropdown.

#### Using Ollama (Local)
1. Toggle "Enable Local Ollama Provider" and select "Ollama (Local)" as the active provider.
2. Ensure you have [Ollama](https://ollama.ai) installed and running on your machine.
3. Set the Ollama Base URL (default is usually `http://localhost:11434`).
4. Click "Refresh & Recommend". This will fetch installed models, test their vision capabilities, and recommend the best one.
5. If you want, the plugin can even recommend models to download directly (e.g., `llava`).

## How to Use

1. Open a note where you want the transcription to appear.
2. Open the command palette (`Ctrl/Cmd + P`) and search for: **Transcribe PDF with handwritten notes**
3. A modal will appear. Select the file you want to transcribe (PDF or Image).
4. Configure any overrides for this specific transcription (Pages to process, Content Mode).
5. Click **Transcribe**. The plugin will read the file, process it with the AI, and insert the markdown directly into your active note.

## Development

- Make sure your NodeJS is at least v16 (`node --version`).
- `npm i` or `yarn` to install dependencies.
- `npm run dev` to start compilation in watch mode.
- `npm run build` to build for production.

## Acknowledgements

Built for Obsidian by the community. Uses `pdf.js` for local PDF rendering.
