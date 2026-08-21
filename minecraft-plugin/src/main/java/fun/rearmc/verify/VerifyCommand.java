package fun.rearmc.verify;

import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

public class VerifyCommand implements CommandExecutor {

    private final RearMCVerify plugin;
    private final HttpClient httpClient;

    public VerifyCommand(RearMCVerify plugin) {
        this.plugin = plugin;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage(ChatColor.RED + "This command can only be used by players in-game.");
            return true;
        }

        // AuthMe password authentication check for cracked servers
        if (plugin.getServer().getPluginManager().isPluginEnabled("AuthMe")) {
            try {
                Class<?> authMeApiClass = Class.forName("fr.xephi.authme.api.v3.AuthMeApi");
                Object apiInstance = authMeApiClass.getMethod("getInstance").invoke(null);
                Boolean isAuthenticated = (Boolean) authMeApiClass.getMethod("isAuthenticated", Player.class).invoke(apiInstance, player);
                if (isAuthenticated != null && !isAuthenticated) {
                    player.sendMessage(ChatColor.RED + "❌ You must log in with your password (/login <password>) before verifying!");
                    return true;
                }
            } catch (Exception ignored) {}
        }

        if (args.length < 1) {
            player.sendMessage(ChatColor.RED + "Usage: /verify <TOKEN>");
            player.sendMessage(ChatColor.GRAY + "Get your token by running /verify in our Discord server.");
            return true;
        }

        String token = args[0].toUpperCase().trim();
        String uuid = player.getUniqueId().toString();
        String username = player.getName();

        player.sendMessage(ChatColor.YELLOW + "⌛ Validating token " + ChatColor.AQUA + token + ChatColor.YELLOW + "...");

        // Asynchronously call backend REST API
        plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                String baseUrl = plugin.getConfig().getString("api-url", "http://wings.desact.in:2000");
                // Remove trailing slash if present, then append the path
                if (baseUrl.endsWith("/")) {
                    baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
                }
                String apiUrl = baseUrl + "/api/verification/complete";
                String apiSecret = plugin.getConfig().getString("api-secret", "rearmc-verify-secret");

                String jsonBody = String.format(
                        "{\"token\":\"%s\",\"minecraft_uuid\":\"%s\",\"minecraft_username\":\"%s\"}",
                        token, uuid, username
                );

                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(apiUrl))
                        .header("Content-Type", "application/json")
                        .header("x-api-secret", apiSecret)
                        .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
                        .timeout(Duration.ofSeconds(10))
                        .build();

                HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

                plugin.getServer().getScheduler().runTask(plugin, () -> {
                    if (response.statusCode() == 200) {
                        plugin.unfreezeAndCancelTimeout(player.getUniqueId());
                        
                        // Kick the player instantly upon successful verification
                        String kickMessage = ChatColor.GREEN + "========================================\n" +
                                             ChatColor.GREEN + "  ✔ VERIFICATION SUCCESSFUL!\n\n" +
                                             ChatColor.WHITE + "  Linked IGN: " + ChatColor.YELLOW + username + "\n" +
                                             ChatColor.GREEN + "  You have been granted the Verified role!\n" +
                                             ChatColor.GREEN + "========================================\n\n" +
                                             ChatColor.AQUA + "You may now join the main server!";
                                             
                        player.kickPlayer(kickMessage);
                    } else {
                        String errorMsg = "Verification failed. Check token and try again.";
                        if (response.body().contains("error")) {
                            // Extract basic error string from json if present
                            errorMsg = response.body().replaceAll(".*\"error\":\"([^\"]+)\".*", "$1");
                        }
                        player.sendMessage(ChatColor.RED + "❌ Verification Failed: " + errorMsg);
                    }
                });
            } catch (Exception e) {
                plugin.getLogger().severe("Error sending verification request: " + (e.getMessage() != null ? e.getMessage() : e.toString()));
                plugin.getServer().getScheduler().runTask(plugin, () -> {
                    player.sendMessage(ChatColor.RED + "❌ Could not connect to verification backend. Please try again later.");
                });
            }
        });

        return true;
    }
}
