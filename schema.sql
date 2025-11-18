CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  discord_user_id VARCHAR(32) NOT NULL UNIQUE,
  display_name VARCHAR(255),
  birthday DATE,
  about TEXT,
  preferences JSON,
  codewords JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guilds (
  id INT AUTO_INCREMENT PRIMARY KEY,
  discord_guild_id VARCHAR(32) NOT NULL UNIQUE,
  primary_language VARCHAR(8) DEFAULT 'en',
  secondary_language VARCHAR(8),
  secondary_language_enabled TINYINT(1) DEFAULT 0,
  selected_user_id INT,
  xp_enabled TINYINT(1) DEFAULT 1,
  leaderboard_enabled TINYINT(1) DEFAULT 1,
  rules_enabled TINYINT(1) DEFAULT 1,
  memory_enabled TINYINT(1) DEFAULT 1,
  xp_per_interaction INT DEFAULT 15,
  xp_announcement_channel_id VARCHAR(32),
  log_channel_id VARCHAR(32),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_guild_selected_user FOREIGN KEY (selected_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS xp_levels (
  id INT AUTO_INCREMENT PRIMARY KEY,
  guild_id INT NOT NULL,
  level INT NOT NULL,
  threshold INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_level_per_guild (guild_id, level),
  CONSTRAINT fk_xp_levels_guild FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS level_roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  guild_id INT NOT NULL,
  level INT NOT NULL,
  role_id VARCHAR(32) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_role_per_level (guild_id, level),
  CONSTRAINT fk_level_roles_guild FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_guild_stats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  guild_id INT NOT NULL,
  xp INT DEFAULT 0,
  level INT DEFAULT 1,
  last_xp_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_guild (user_id, guild_id),
  CONSTRAINT fk_stats_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_stats_guild FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rulesets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  guild_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  type ENUM('game','server','custom') DEFAULT 'custom',
  summary TEXT,
  content MEDIUMTEXT NOT NULL,
  created_by_user_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rulesets_guild FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE,
  CONSTRAINT fk_rulesets_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_memories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  guild_id INT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_memories_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_memories_guild FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE,
  INDEX idx_memory_lookup (user_id, guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
