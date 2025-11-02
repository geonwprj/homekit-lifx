#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

PROJECT_DIR="/opt/homekit-lifx"
REPO_URL="https://github.com/geonwprj/homekit-lifx.git" # <<< CHANGE THIS TO YOUR REPO URL
SERVICE_NAME="homekit-lifx"

# --- 1. Check for prerequisites (Node.js and npm) ---
echo "Checking for Node.js and npm..."

if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
    echo "Node.js or npm not found. Attempting to install for Ubuntu..."
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        if [ "$ID" = "ubuntu" ]; then
            echo "Detected Ubuntu. Installing Node.js and npm..."
            sudo apt-get update
            sudo apt-get install -y ca-certificates curl gnupg
            sudo mkdir -p /etc/apt/keyrings
            curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
            NODE_MAJOR=20 # Or desired LTS version
            echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_"$NODE_MAJOR".x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
            sudo apt-get update
            sudo apt-get install -y nodejs
            echo "Node.js and npm installed successfully."
        else
            echo "Detected non-Ubuntu OS. Please install Node.js and npm manually."
            exit 1
        fi
    else
        echo "Could not detect OS. Please install Node.js and npm manually."
        exit 1
    fi
fi

echo "Node.js and npm found."

# --- 2. Clone Repository ---
echo "Cloning repository to $PROJECT_DIR..."
if [ -d "$PROJECT_DIR" ]; then
    echo "Directory $PROJECT_DIR already exists. Pulling latest changes..."
    git -C "$PROJECT_DIR" pull
else
    sudo git clone "$REPO_URL" "$PROJECT_DIR"
fi

# --- 3. Install Dependencies and Build Project ---
echo "Installing dependencies and building project..."
sudo bash -c "cd $PROJECT_DIR && npm install && npm run build"

# --- 4. Create default config.json if it doesn't exist ---
CONFIG_FILE="$PROJECT_DIR/config.json"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Creating default config.json..."
    sudo bash -c "cat > $CONFIG_FILE <<EOF
{
  \"pincode\": null,
  \"discriminator\": 3840,
  \"vendorId\": 65521,
  \"productId\": 32768,
  \"uniqueId\": null,
  \"lifxApiKey\": \"YOUR_LIFX_API_KEY\",
  \"homekitLightId\": \"YOUR_LIFX_LIGHT_ID\"
}
EOF"
    echo "Please edit $CONFIG_FILE with your LIFX API Key and Light ID."
else
    echo "config.json already exists. Skipping creation."
fi

# --- 5. Register as a Systemd Service ---
echo "Registering $SERVICE_NAME as a systemd service..."
SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME.service"

sudo bash -c "cat > $SERVICE_FILE <<EOF
[Unit]
Description=HomeKit LIFX Bridge Service
After=network.target

[Service]
ExecStart=/usr/bin/node $PROJECT_DIR/dist/src/index.js
WorkingDirectory=$PROJECT_DIR
StandardOutput=inherit
StandardError=inherit
Restart=always
User=root

[Install]
WantedBy=multi-user.target
EOF"

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl start "$SERVICE_NAME"

echo "Service $SERVICE_NAME registered, enabled, and started."
echo "You can check its status with: sudo systemctl status $SERVICE_NAME"
echo "Logs can be viewed with: journalctl -u $SERVICE_NAME -f"

echo "Installation complete!"
