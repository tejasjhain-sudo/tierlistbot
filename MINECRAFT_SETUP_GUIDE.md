# RearmC Minecraft Verification Server & Plugin Setup Guide

This guide provides full step-by-step instructions to create, configure, and run the **Minecraft Verification Server** and install the **RearMCVerify** plugin.

---

## 1. MINECRAFT SERVER REQUIREMENTS & VERSION

| Specification | Value |
|---|---|
| **Server Software** | **Paper 1.21** (Recommended) or **Paper 1.20.4** |
| **Java Version** | **Java 21** (OpenJDK 21 / Eclipse Temurin 21) |
| **Server Type** | Standalone PaperMC Server or BungeeCord / Velocity Sub-Server |
| **Recommended Port** | `25565` (Domain: `verify.rearmc.fun`) |

---

## 2. STEP-BY-STEP MINECRAFT SERVER SETUP

### Step 1: Install Java 21
Make sure Java 21 is installed on your server host:
```bash
# Ubuntu / Debian
sudo apt update
sudo apt install openjdk-21-jre-headless -y

# Verify Java version
java -version
```

### Step 2: Download Paper 1.21 Server JAR
Create a folder for your verification server and download Paper:
```bash
mkdir -p ~/rearmc-verify-server
cd ~/rearmc-verify-server

# Download Paper 1.21 latest build
curl -o paper.jar https://api.papermc.io/v2/projects/paper/versions/1.21/builds/130/downloads/paper-1.21-130.jar
```

### Step 3: Accept Minecraft EULA
Run the server once to generate configuration files:
```bash
java -Xms1G -Xmx2G -jar paper.jar nogui
```
Edit `eula.txt`:
```properties
eula=true
```

### Step 4: Configure `server.properties`
Open `server.properties` and ensure the following settings:
```properties
server-port=25565
online-mode=true
motd=\u00A76\u00A7lRearmC \u00A77|\u00A7f Verification Server (verify.rearmc.fun)
pvp=false
spawn-protection=999999
gamemode=adventure
allow-flight=true
```

---

## 3. INSTALL & CONFIGURE THE `RearMCVerify` PLUGIN

### Option A: Build Plugin from Source Code
The plugin source code is located in the repository under `minecraft-plugin/`.

Build using Maven:
```bash
cd minecraft-plugin
mvn clean package
```
This produces `target/RearMCVerify-1.0.0.jar`.

### Option B: Install Plugin into Server
1. Copy `RearMCVerify-1.0.0.jar` into your Minecraft server's `plugins/` directory:
   ```bash
   cp minecraft-plugin/target/RearMCVerify-1.0.0.jar ~/rearmc-verify-server/plugins/
   ```
2. Start the Minecraft server to generate `plugins/RearMCVerify/config.yml`:
   ```bash
   java -Xms1G -Xmx2G -jar paper.jar nogui
   ```
3. Edit `plugins/RearMCVerify/config.yml`:
   ```yaml
   # REST API endpoint matching your Discord Bot IP/Domain
   api-url: "http://YOUR_BOT_SERVER_IP:3000/api/verification/complete"

   # Secret key matching API_SECRET in your bot's .env file
   api-secret: "rearmc-verify-secret"

   # Server domain displayed in-game
   server-name: "verify.rearmc.fun"
   ```
4. Reload or restart the Minecraft server (`/reload confirm` or restart).

---

## 4. BOT ENVIRONMENT VARIABLES (`.env`)

In your Discord Bot directory (`/Users/tejas/Downloads/rearmctierlist`), update `.env`:

```env
# Minecraft Verification Config
MINECRAFT_VERIFY_SERVER=verify.rearmc.fun
API_SECRET=rearmc-verify-secret
PUBLIC_API_URL=http://YOUR_BOT_SERVER_IP:3000
```

---

## 5. USER VERIFICATION FLOW (END-TO-END)

1. User types **/verify** in Discord or clicks **Verify Account** on the evaluation testing panel.
2. Bot generates a unique 10-minute token: `RM-7X29-KD8P`.
3. User joins Minecraft server: `verify.rearmc.fun`.
4. User types in Minecraft chat:
   ```text
   /verify RM-7X29-KD8P
   ```
5. Plugin sends an authentic POST request to `api-url` with `x-api-secret`.
6. API verifies token, links `Discord ID ↔ Minecraft UUID ↔ IGN` permanently in PostgreSQL database, and grants `@Verified` role in Discord.
7. User receives green success message in Minecraft & Discord notification!
