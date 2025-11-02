# HomeKit LIFX Bridge

A bridge to integrate LIFX lights with Apple HomeKit using the Matter protocol.

## Features

-   Control LIFX lights (On/Off, Brightness, Color, Color Temperature) via HomeKit.
-   Web interface for configuration and monitoring.
-   Dynamic device naming in HomeKit based on LIFX Light ID.

## Setup

1.  **Automated Installation (Recommended for Ubuntu):**

    To install the project and register it as a systemd service, run the following command:

    ```bash
    curl -L https://raw.githubusercontent.com/geonwprj/homekit-lifx/main/install.sh | bash
    ```
    **Note:** Remember to replace `YOUR_GITHUB_USERNAME` with your actual GitHub username.

2.  **Manual Setup (if not using automated script or on other OS):**

    a.  **Install Dependencies:**

        ```bash
        npm install
        ```

    b.  **Build the Application:**

        ```bash
        npm run build
        ```

    c.  **Run the Application:**

        ```bash
        node dist/src/index.js
        ```

        The application will start a web server on `http://localhost:3000` (or a port defined by `WEB_PORT` environment variable) and a Matter server.

3.  **Configuration (`config.json`):**

## Usage

1.  **Access the Info Page:**

    Open `http://localhost:3000/info` in your web browser to view the HomeKit pairing QR code, configure your LIFX API key, select the HomeKit-controlled light, and monitor application logs.

2.  **Pair with Apple Home:**

    Scan the displayed QR code on the info page with your Apple Home app to add the LIFX bridge as an accessory.

3.  **Control Lights:**

    Once paired, you can control the selected LIFX light (On/Off, Brightness, Color, Color Temperature) directly from the Apple Home app.

## Troubleshooting

-   **Application Crashes:** Check the console output for any error messages. Ensure your `config.json` is correctly formatted and contains valid API keys and light IDs.
-   **QR Code Not Displaying/Pairing:** Verify your `lifxApiKey` and `homekitLightId` in `config.json`. Check the console logs on the info page for any related errors.
-   **Color/Brightness Not Changing:** Ensure the correct LIFX light ID is configured. Check the console logs for LIFX API errors.
-   **Logs Not Loading/Refreshing:** Ensure the backend server is running and accessible. Check your browser's developer console for any frontend errors.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
