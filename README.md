# F1 Telemetry Dashboard 🏎️

![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Version](https://img.shields.io/badge/Version-1.3.0-green.svg)

A modern, professional Formula 1-inspired telemetry dashboard designed to visualize racing data in real-time. This application provides race-engineering style insights including speed, throttle, brake pressure, steering angle, gear selection, tyre information, lap performance metrics, and dynamic sector timing.

It seamlessly intercepts UDP telemetry data from F1 racing titles and streams it to a beautiful, highly responsive, and data-dense frontend web dashboard.

---

## 🌟 Comprehensive Feature Set

### 📡 Server & Networking Engine
*   **High-Frequency Telemetry Parsing**: Decodes raw UDP packets using `@deltazeroproduction/f1-udp-parser`.
*   **Variable WebSocket Broadcasting**: Configurable server update rate (Hz) to match your game output (10, 20, 30, or 60 Hz) for optimized network performance.
*   **Multi-Client Support**: Run the server once and connect multiple dashboards from different devices (e.g., tablet, phone, secondary monitor) simultaneously via your local network.

### ⏱️ Advanced Timing & Sector Analysis
*   **Live Instantaneous Sectors**: Calculates accurate live sector timings (`liveS1`, `liveS2`, `liveS3`) based on real-time track distance, rather than waiting for the game's official split broadcast.
*   **F1-Standard Sector Colors**: Automatically applies standard coloring logic upon sector completion: **Purple** (Overall Best), **Green** (Personal Best), and **Yellow** (Slower).
*   **Custom Sector Creation**: Users can drop custom sector lines on the track map dynamically to analyze micro-sectors.

### 👻 Ghost Data & Live Delta Tracking
*   **Persistent Track Records**: The backend automatically tracks and saves the all-time fastest lap for every circuit to local JSON files (`laptime/fastest_TRACKID.json`).
*   **Telemetry Ghost Capture**: When you set a new track record, the server captures a high-resolution telemetry ghost mapping time against track distance.
*   **Live Delta to Record**: The server interpolates your current track distance against the ghost telemetry in real-time to compute a highly accurate live delta (+/- seconds) against the track record.

### 🗺️ Dynamic 3D Track Mapping
*   **Auto-Generation**: If a track is unmapped, the server uses your car's X and Z coordinates to "drive" and physically draw the track layout, saving it permanently (`track_maps/track_TRACKID.json`).
*   **Intelligent Sector Lines**: Uses your telemetry split times to automatically drop official Sector 1 and Sector 2 lines at the exact physical coordinates on the 3D map.
*   **Auto-Pit Lane**: Algorithmically estimates and draws the pit lane trajectory based on the main track geometry.

### 📊 Dynamic Leaderboards & Intervals
*   **Time Attack / Quali Mode**: Sorts the grid by lap times, formatting gaps precisely to the Pole Sitter.
*   **Race Interval Engine**: Sorts the grid by physical position and calculates live interval gaps to the car ahead.
*   **Fallback Interval Math**: If the game's official delta drops out, the server calculates an estimated time gap using physical distance and relative speed (marked with a `*`).

### 🏎️ Vehicle Physics & Health Monitoring
*   **Live Input Gauges**: Throttle, Brake, Clutch, Steering Angle, Gear, RPM, and Speed.
*   **Motion & Suspension**: Pitch, Roll, Lateral/Longitudinal/Vertical G-Forces, and individual suspension positions.
*   **Tyre Management**: Tracks Visual and Actual compounds, tyre age, individual tyre wear (FL, FR, RL, RR), surface temperatures, inner temperatures, and pressures.
*   **Powertrain & Brakes**: Monitors Engine Temperature, individual Brake Temperatures, and ERS (Battery % and Deploy Mode).

### 🚦 Race Control & Session Data
*   **Automatic Metadata**: Translates raw game IDs into real-world Track Names, Session Types, and Team Names/Colors.
*   **Safety Status**: Tracks Track Flags (Green, Yellow, Blue, Red), Safety Car status (Full, VSC), and live weather.
*   **Steward Information**: Tracks warnings, corner-cutting violations, invalidated lap statuses, and unserved drive-through/stop-go penalties.

### 🎥 Online Streaming & Remote Viewing
*   **OBS / StreamLabs Integration**: Perfect for sim racing streamers! Capture the dashboard window or add it as a Browser Source to overlay professional, live telemetry directly onto your Twitch or YouTube stream.
*   **Live Viewer Access**: Host the Node.js backend publicly (e.g., using `ngrok`, local network tunneling, or port forwarding) and share the URL with your viewers, friends, or a dedicated race engineer. They can open the dashboard in their own web browser and monitor your live telemetry and inputs in absolute real-time, creating an interactive pit-wall experience!

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
*   `track_maps/`: Contains JSON files dynamically generated by the server defining the 3D track geometries.
*   `laptime/`: Contains all-time fastest lap records per track.
*   `telemetry/`: Contains Ghost telemetry arrays for delta tracking.
*   `package.json`: Project metadata and dependencies.

---

## 📜 License

This project is open-source and available under the [MIT License](LICENSE). 
Created by **Gokulnath**. Free to use, modify, and distribute for racing enthusiasts and developers.