// 演示数据：租户+三账号+部门+员工（密码统一 Passw0rd!）
const bcrypt = require('bcryptjs');
const { Client } = require('pg');
(async () => {
  const c = new Client({ host: '127.0.0.1', port: 55432, user: 'postgres', password: 'postgres', database: 'zhiwei_dev' });
  await c.connect();
  const hash = await bcrypt.hash('Passw0rd!', 8);
  await c.query(`INSERT INTO tenant (name) VALUES ('智未科技') ON CONFLICT DO NOTHING`);
  const t = (await c.query(`SELECT id FROM tenant WHERE name='智未科技'`)).rows[0].id;
  const mkUser = async (mobile, name, roles) => (await c.query(
    `INSERT INTO "user" (tenant_id,mobile,password_hash,name,roles,updated_at) VALUES ($1,$2,$3,$4,$5,NOW()) ON CONFLICT (tenant_id,mobile) DO UPDATE SET roles=$5 RETURNING id`,
    [t, mobile, hash, name, roles])).rows[0].id;
  const hr = await mkUser('13900000001', '徐HR', ['hr_admin']);
  const mgrU = await mkUser('13900000002', '王经理', ['manager']);
  const empU = await mkUser('13900000003', '李四', ['employee']);
  await c.query(`INSERT INTO department (tenant_id,code,name,created_at,updated_at) SELECT $1,'HQ','智未科技',NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM department WHERE tenant_id=$1 AND code='HQ') ON CONFLICT DO NOTHING`, [t]);
  await c.query(`INSERT INTO department (tenant_id,code,name,created_at,updated_at) SELECT $1,'SALES','销售部',NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM department WHERE tenant_id=$1 AND code='SALES')`, [t]);
  const sales = (await c.query(`SELECT id FROM department WHERE tenant_id=$1 AND code='SALES'`, [t])).rows[0].id;
  const mkEmp = async (empNo, name, mobile, uid, mid) => c.query(
    `INSERT INTO employee (tenant_id,emp_no,name,mobile,hire_date,position,department_id,manager_emp_id,user_id,created_at,updated_at) VALUES ($1,$2,$3,$4,'2023-01-01','专员',$5,$6,$7,NOW(),NOW()) ON CONFLICT (tenant_id,emp_no) DO NOTHING`,
    [t, empNo, name, mobile, sales, mid, uid]);
  const mgrEmp = (await c.query(
    `INSERT INTO employee (tenant_id,emp_no,name,mobile,hire_date,position,department_id,user_id,created_at,updated_at) VALUES ($1,'M001','王经理','13900000002','2020-01-01','经理',$2,$3,NOW(),NOW()) ON CONFLICT (tenant_id,emp_no) DO UPDATE SET user_id=$3 RETURNING id`,
    [t, sales, mgrU])).rows[0].id;
  await mkEmp('E001', '李四', '13900000003', empU, mgrEmp);
  await c.query(`INSERT INTO user_preference (tenant_id,user_id,theme,created_at,updated_at) VALUES ($1,$2,'coral',NOW(),NOW()) ON CONFLICT (user_id) DO NOTHING`, [t, hr]);
  console.log('SEED-OK');
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
