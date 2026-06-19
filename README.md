# F1 Telemetry Dashboard 🏎️

![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Version](https://img.shields.io/badge/Version-1.2.0-green.svg)

A modern, professional Formula 1-inspired telemetry dashboard designed to visualize racing data in real-time. This application provides race-engineering style insights including speed, throttle, brake pressure, steering angle, gear selection, tyre information, lap performance metrics, and dynamic sector timing.

It seamlessly intercepts UDP telemetry data from F1 racing titles and streams it to a beautiful, highly responsive, and data-dense frontend web dashboard.

---

## 🌟 Key Features

*   **Real-Time Telemetry Visualization**: Streams game data over WebSockets for instant dashboard updates.
*   **FIA-Inspired Interface**: A clean, professional dark-mode UI designed to look like real race engineer timing screens.
*   **Live Input Monitoring**: Real-time gauges for Throttle, Brake, Clutch, Steering, and DRS status.
*   **Dynamic Track Maps**: Uses `Three.js` to render live 3D track maps with custom sectors, start lines, and real-time car positioning.
*   **Advanced Timing & Sector Analysis**: 
    *   Tracks live and completed sector times.
    *   Automatically applies F1-standard coloring: **Purple** (Overall Best), **Green** (Personal Best), and **Yellow** (Slower).
    *   Computes instantaneous deltas against session bests and previous laps.
*   **Tyre & Vehicle Health**: Tracks tyre wear, compound type, surface/inner temperatures, brake temperatures, and engine stats.
*   **Live Leaderboards & Session History**: Displays full session classifications, tyre histories, and lap-by-lap breakdowns for all participants.
*   **G-Force & Motion Data**: Real-time G-Force meters and vehicle pitch/roll tracking.

---

## 🛠️ Technology Stack

**Backend:**
*   **Node.js**: Powers the backend server.
*   **ws / socket.io**: Handles low-latency WebSocket communication between the server and clients.
*   **@deltazeroproduction/f1-udp-parser**: Decodes raw UDP packets emitted by the F1 game.

**Frontend:**
*   **HTML5 / CSS3 / Vanilla JavaScript**: For a lightweight, fast, and dependency-free UI.
*   **Three.js**: Renders interactive 3D track geometry and live car meshes.

---

## 🚀 Getting Started

### Prerequisites

*   **Node.js** (v16.x or newer recommended)
*   An F1 Game (e.g., F1 23, F1 24) capable of sending UDP Telemetry data.

### Installation

1.  **Clone or download the repository.**
2.  **Install dependencies:**
    Open a terminal in the project directory and run:
    ```bash
    npm install
    ```

### Usage

1.  **Start the Telemetry Server:**
    Run the server manually using Node.js, optionally specifying the update rate (Hz). 
    Valid inputs are `10`, `20`, `30`, and `60` (F1 game standards). If omitted or invalid, it defaults to `20`.
    ```bash
    node server.js 60
    ```
    *(Alternatively, double-click `run.bat` on Windows for the default 20Hz)*

2.  **Configure the F1 Game:**
    *   Go to **Settings > Telemetry Settings** in your F1 game.
    *   Enable **UDP Telemetry**.
    *   Set the **UDP IP Address** to `127.0.0.1` (or your machine's IP).
    *   Set the **UDP Port** to the port configured in the server (default usually `20777`).
    *   Set the **UDP Send Rate** (e.g., 20Hz or 60Hz).

3.  **Open the Dashboard:**
    *   Open your web browser and navigate to the dashboard (e.g., `http://localhost:3000` or simply opening `index.html` depending on your setup).
    *   Ensure the WebSocket status shows as **CONNECTED**.

---

## 📂 Project Structure

*   `server.js`: The main Node.js backend. Listens for UDP telemetry and broadcasts it via WebSockets.
*   `index.html`: The frontend dashboard layout and core logic.
*   `styles.css`: (If present) The CSS styling for the dashboard.
*   `track_maps/`: Contains JSON files defining the 3D track geometries and coordinate paths.
*   `package.json`: Project metadata and dependencies.

---

## 📜 License

This project is open-source and available under the [MIT License](LICENSE). 
Created by **Gokulnath**. Free to use, modify, and distribute for racing enthusiasts and developers.