#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
mkdir -p src
cat > src/NotificationList.jsx <<'JSX'
export function NotificationList({ notifications }) {
  return (
    <ul>
      {notifications.map((notification) => (
        <li key={notification.id}>{notification.message}</li>
      ))}
    </ul>
  );
}
JSX
printf '{\n  "name": "my-app",\n  "dependencies": { "react": "^19.0.0" }\n}\n' > package.json
