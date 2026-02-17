#!/bin/sh
# Ensure Claude session directory exists and is writable by node user
# Volume may be empty or owned by root on first run
mkdir -p /home/node/.claude/projects
chown -R node:node /home/node/.claude

mkdir -p /data
chown -R node:node /data

# Ensure node_modules is writable — libraries may create caches inside their own dirs
chown -R node:node /app/node_modules

# Drop privileges and run the main command as node
export HOME=/home/node
exec setpriv --reuid=node --regid=node --init-groups "$@"
