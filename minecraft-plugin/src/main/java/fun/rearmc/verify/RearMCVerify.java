package fun.rearmc.verify;

import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class RearMCVerify extends JavaPlugin implements Listener {

    private static RearMCVerify instance;
    private final Map<UUID, BukkitTask> timeoutTasks = new ConcurrentHashMap<>();
    private final Set<UUID> frozenPlayers = ConcurrentHashMap.newKeySet();

    @Override
    public void onEnable() {
        instance = this;
        saveDefaultConfig();

        if (getCommand("verify") != null) {
            getCommand("verify").setExecutor(new VerifyCommand(this));
        }

        getServer().getPluginManager().registerEvents(this, this);

        getLogger().info("========================================");
        getLogger().info("  RearMCVerify Plugin v1.1 Enabled!     ");
        getLogger().info("  API: " + getConfig().getString("api-url"));
        getLogger().info("  Join-Guard: ENABLED (Discord session required)");
        getLogger().info("========================================");
    }

    @Override
    public void onDisable() {
        for (BukkitTask task : timeoutTasks.values()) {
            task.cancel();
        }
        timeoutTasks.clear();
        frozenPlayers.clear();
    }

    public static RearMCVerify getInstance() {
        return instance;
    }

    public void unfreezeAndCancelTimeout(UUID uuid) {
        frozenPlayers.remove(uuid);
        BukkitTask task = timeoutTasks.remove(uuid);
        if (task != null) task.cancel();
    }

    // ─── Check if player is allowed to join via API ───────────────────────────
    // Returns null = ALLOWED, non-null String = kick reason
    private String checkCanJoin(String username) {
        try {
            String apiUrl = getConfig().getString("api-url", "http://wings.desact.in:2000");
            URL url = new URL(apiUrl + "/api/verification/can-join/" + username.toLowerCase());

            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(3000);

            int code = conn.getResponseCode();
            BufferedReader reader = new BufferedReader(new InputStreamReader(
                    code == 200 ? conn.getInputStream() : conn.getErrorStream()
            ));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
            reader.close();
            conn.disconnect();

            String body = sb.toString();
            if (body.contains("\"allowed\":true")) return null; // allowed

            // Extract reason
            String reason = "No active verification session found.";
            if (body.contains("\"reason\":\"")) {
                int s = body.indexOf("\"reason\":\"") + 10;
                int e = body.indexOf("\"", s);
                if (e > s) reason = body.substring(s, e);
            }
            return reason;

        } catch (Exception e) {
            getLogger().warning("Can-join API check failed for " + username + ": " + e.getMessage());
            return null; // fail-open
        }
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onPlayerJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        UUID uuid = player.getUniqueId();
        String username = player.getName();
        RearMCVerify plugin = this;

        // Async API check — don't block main thread
        Bukkit.getScheduler().runTaskAsynchronously(this, new Runnable() {
            @Override
            public void run() {
                String kickReason = checkCanJoin(username);

                if (kickReason != null) {
                    // Not allowed — kick on main thread
                    final String reason = kickReason;
                    Bukkit.getScheduler().runTask(plugin, new Runnable() {
                        @Override
                        public void run() {
                            if (player.isOnline()) {
                                player.kickPlayer(
                                    ChatColor.RED + "" + ChatColor.BOLD + "Access Denied\n\n" +
                                    ChatColor.YELLOW + "You need a Discord session to join!\n\n" +
                                    ChatColor.WHITE + "Steps:\n" +
                                    ChatColor.GREEN + "1. " + ChatColor.WHITE + "Go to your Discord server\n" +
                                    ChatColor.GREEN + "2. " + ChatColor.WHITE + "Click " + ChatColor.AQUA + "\"Verify Account\"" +
                                    ChatColor.WHITE + " or " + ChatColor.AQUA + "\"Update Account\"\n" +
                                    ChatColor.GREEN + "3. " + ChatColor.WHITE + "Then rejoin this server with your token\n\n" +
                                    ChatColor.GRAY + "Reason: " + reason
                                );
                            }
                        }
                    });
                    return;
                }

                // Allowed — set up verify flow on main thread
                Bukkit.getScheduler().runTask(plugin, new Runnable() {
                    @Override
                    public void run() {
                        if (!player.isOnline()) return;

                        // Freeze player
                        frozenPlayers.add(uuid);

                        // Teleport to spawn
                        Location spawn = new Location(player.getWorld(), 0.5, 64.0, 0.5, 0.0f, 0.0f);
                        Location platform = new Location(player.getWorld(), 0, 63, 0);
                        platform.getBlock().setType(Material.BARRIER);
                        player.teleport(spawn);
                        player.setGameMode(GameMode.ADVENTURE);

                        // 5-minute auto-kick timer
                        BukkitTask task = Bukkit.getScheduler().runTaskLater(plugin, new Runnable() {
                            @Override
                            public void run() {
                                if (player.isOnline()) {
                                    frozenPlayers.remove(uuid);
                                    timeoutTasks.remove(uuid);
                                    player.kickPlayer(
                                        ChatColor.RED + "Verification Timed Out (5 min)\n\n" +
                                        ChatColor.YELLOW + "Please click Verify/Update Account in Discord and try again."
                                    );
                                }
                            }
                        }, 6000L);
                        timeoutTasks.put(uuid, task);

                        // Send instructions after 0.5s
                        Bukkit.getScheduler().runTaskLater(plugin, new Runnable() {
                            @Override
                            public void run() {
                                if (!player.isOnline()) return;
                                player.sendMessage("");
                                player.sendMessage(ChatColor.GOLD + "========================================");
                                player.sendMessage(ChatColor.YELLOW + "  Welcome to " + ChatColor.BOLD + "RearMC Verify Server!");
                                player.sendMessage("");
                                player.sendMessage(ChatColor.RED + "Movement is frozen until verified.");
                                player.sendMessage(ChatColor.WHITE + "Type: " + ChatColor.GREEN + "/verify <TOKEN>");
                                player.sendMessage(ChatColor.GRAY + "Example: " + ChatColor.DARK_AQUA + "/verify RM-7X29-KD8P");
                                player.sendMessage(ChatColor.YELLOW + "You have 5 minutes.");
                                player.sendMessage(ChatColor.GOLD + "========================================");
                                player.sendMessage("");
                            }
                        }, 10L);
                    }
                });
            }
        });
    }

    @EventHandler
    public void onPlayerMove(PlayerMoveEvent event) {
        Player player = event.getPlayer();
        if (!frozenPlayers.contains(player.getUniqueId())) return;
        Location from = event.getFrom();
        Location to = event.getTo();
        if (to != null && (from.getBlockX() != to.getBlockX() ||
                from.getBlockY() != to.getBlockY() || from.getBlockZ() != to.getBlockZ())) {
            Location lock = from.clone();
            lock.setYaw(to.getYaw());
            lock.setPitch(to.getPitch());
            event.setTo(lock);
        }
    }

    @EventHandler
    public void onPlayerQuit(PlayerQuitEvent event) {
        UUID uuid = event.getPlayer().getUniqueId();
        frozenPlayers.remove(uuid);
        BukkitTask task = timeoutTasks.remove(uuid);
        if (task != null) task.cancel();
    }
}
