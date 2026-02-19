/**
 * Создаёт миграцию без shadow database.
 * Использование: node scripts/migrate-create.js <имя_миграции>
 * Пример: node scripts/migrate-create.js add_quiz_results
 */

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const name = process.argv[2];
if (!name) {
  console.error('Укажите имя миграции: node scripts/migrate-create.js <имя>');
  process.exit(1);
}

const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');
const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 14);
const migrationDir = path.join(migrationsDir, `${timestamp}_${name}`);

fs.mkdirSync(migrationDir, { recursive: true });

const sql = execSync(
  'npx prisma migrate diff --from-config-datasource --to-schema=prisma/schema.prisma --script',
  { encoding: 'utf-8', cwd: path.join(__dirname, '..') },
);

if (!sql.trim()) {
  fs.rmdirSync(migrationDir);
  console.log('Нет изменений — схема совпадает с базой.');
  process.exit(0);
}

fs.writeFileSync(path.join(migrationDir, 'migration.sql'), sql.trim());
console.log(`Миграция создана: prisma/migrations/${path.basename(migrationDir)}/migration.sql`);
console.log('Применить: npx prisma migrate deploy');
