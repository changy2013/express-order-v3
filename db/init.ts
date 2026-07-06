import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function initDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('\x1b[31m%s\x1b[0m', '错误: 未找到 DATABASE_URL 环境变量');
    console.log('请在 .env.local 文件中设置 DATABASE_URL');
    process.exit(1);
  }

  console.log(`正在连接数据库进行初始化: ${databaseUrl.replace(/:[^:@/]+@/, ':****@')}`);

  const client = new Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1') ? false : { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('数据库连接成功！');

    const sqlPath = path.resolve(process.cwd(), 'db/init.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

    console.log('正在执行初始化 SQL 语句...');
    await client.query(sqlContent);

    console.log('\x1b[32m%s\x1b[0m', '数据库初始化成功！所有表结构已创建。');
  } catch (error) {
    console.error('\x1b[31m%s\x1b[0m', '数据库初始化失败:');
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

initDb();
