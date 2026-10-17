#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
mkdir -p src
printf 'export interface User {\n  id: string;\n  email: string;\n}\n' > src/user.ts
printf 'import type { User } from "./user";\n\nexport function signup(user: User) {\n  return user.email.toLowerCase();\n}\n' > src/signup.ts
printf 'import type { User } from "./user";\n\nexport function mailTo(user: User) {\n  return `mailto:${user.email}`;\n}\n' > src/mailer.ts
printf 'import type { User } from "./user";\n\nexport function profileLine(user: User) {\n  return `${user.id} <${user.email}>`;\n}\n' > src/profile.ts
