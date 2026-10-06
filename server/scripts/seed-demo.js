const { Client } = require('pg');
(async () => {
  const c = new Client({ host: '127.0.0.1', port: 55432, user: 'postgres', password: 'postgres', database: 'zhiwei_dev' });
  await c.connect();
  const t = (await c.query(`SELECT id FROM tenant WHERE name='智未科技'`)).rows[0].id;
  const hrU = (await c.query(`SELECT id FROM "user" WHERE mobile='13900000001'`)).rows[0].id;
  const mgrE = (await c.query(`SELECT id FROM employee WHERE emp_no='M001'`)).rows[0].id;
  const empE = (await c.query(`SELECT id FROM employee WHERE emp_no='E001'`)).rows[0].id;
  const sales = (await c.query(`SELECT id FROM department WHERE code='SALES'`)).rows[0].id;
  const now = '2026-10-06', N = () => `NOW()`;
  // 指标
  await c.query(`INSERT INTO indicator (tenant_id,name,definition,calc_desc,score_rule,source_type,data_owner_dept_id,unit,stat_scope,status,created_at,updated_at)
    VALUES ($1,'季度回款额','财务口径回款','完成率计分','{"type":"rate","base":100,"cap":120,"floor":0}','dept_report',$2,'万元','current','ENABLED',NOW(),NOW())
    ON CONFLICT DO NOTHING`, [t, sales]);
  const ind = (await c.query(`SELECT id FROM indicator WHERE name='季度回款额'`)).rows[0].id;
  // 方案
  const sc = (await c.query(`INSERT INTO scheme (tenant_id,name,mode,period_type,status,version,created_at,updated_at) VALUES ($1,'销售部Q4考核','kpi','quarter','LOCKED',1,NOW(),NOW()) ON CONFLICT DO NOTHING RETURNING id`, [t])).rows[0];
  const schemeId = sc ? sc.id : (await c.query(`SELECT id FROM scheme WHERE name='销售部Q4考核'`)).rows[0].id;
  await c.query(`INSERT INTO scheme_indicator (tenant_id,scheme_id,indicator_id,weight,created_at,updated_at) VALUES ($1,$2,$3,100,NOW(),NOW()) ON CONFLICT DO NOTHING`, [t, schemeId, ind]).catch(()=>{});
  await c.query(`INSERT INTO scheme_node (tenant_id,scheme_id,node_type,seq,enabled,created_at,updated_at) VALUES ($1,$2,'goal_setting',1,true,NOW(),NOW()),($1,$2,'self_review',2,true,NOW(),NOW()),($1,$2,'manager_review',3,true,NOW(),NOW()),($1,$2,'calibrating',4,true,NOW(),NOW()),($1,$2,'result_confirm',5,true,NOW(),NOW()) ON CONFLICT DO NOTHING`, [t, schemeId]).catch(()=>{});
  await c.query(`INSERT INTO scheme_reviewer (tenant_id,scheme_id,reviewer_type,weight,created_at,updated_at) VALUES ($1,$2,'self',20,NOW(),NOW()),($1,$2,'manager',80,NOW(),NOW()) ON CONFLICT DO NOTHING`, [t, schemeId]).catch(()=>{});
  await c.query(`INSERT INTO scheme_grade_rule (tenant_id,scheme_id,grade,min_score,max_score,sort_no,created_at,updated_at) VALUES ($1,$2,'S',90,100,1,NOW(),NOW()),($1,$2,'A',80,89.99,2,NOW(),NOW()),($1,$2,'B',70,79.99,3,NOW(),NOW()),($1,$2,'C',60,69.99,4,NOW(),NOW()),($1,$2,'D',0,59.99,5,NOW(),NOW()) ON CONFLICT DO NOTHING`, [t, schemeId]).catch(()=>{});
  // 考核任务+考核单（李四 self_review 有目标值+自评分；王经理 manager_review 已打分）
  const tk = (await c.query(`INSERT INTO assessment_task (tenant_id,scheme_id,scheme_version,name,period,start_date,end_date,status,created_at) VALUES ($1,$2,1,'Q4绩效考核','2026Q4','2026-10-01','2026-12-31','RUNNING',NOW()) ON CONFLICT DO NOTHING RETURNING id`, [t, schemeId])).rows[0];
  const taskId = tk ? tk.id : (await c.query(`SELECT id FROM assessment_task WHERE name='Q4绩效考核'`)).rows[0].id;
  await c.query(`INSERT INTO assessment_record (tenant_id,task_id,emp_id,manager_emp_id,status) VALUES ($1,$2,$3,$4,'self_review') ON CONFLICT DO NOTHING`, [t, taskId, empE, mgrE]);
  await c.query(`INSERT INTO assessment_record (tenant_id,task_id,emp_id,manager_emp_id,status,final_score,grade) VALUES ($1,$2,$3,$4,'manager_review',85.5,'A') ON CONFLICT DO NOTHING`, [t, taskId, mgrE, mgrE]);
  await c.query(`INSERT INTO record_indicator (tenant_id,record_id,indicator_id,target_value,self_score,self_comment,manager_score,weighted_score,score_source)
    SELECT $1,r.id,$2,500,88,'回款进度良好',null,null,'review' FROM assessment_record r WHERE r.task_id=$3 AND r.status='self_review' ON CONFLICT DO NOTHING`, [t, ind, taskId]);
  await c.query(`INSERT INTO record_indicator (tenant_id,record_id,indicator_id,target_value,self_score,manager_score,weighted_score,score_source)
    SELECT $1,r.id,$2,500,85,86,85.5,'review' FROM assessment_record r WHERE r.status='manager_review' ON CONFLICT DO NOTHING`, [t, ind]);
  // 过程任务 + 悬赏
  await c.query(`INSERT INTO work_task (tenant_id,title,description,assignee_emp_id,publisher_emp_id,priority,status,source,due_date,created_at) VALUES
    ($1,'整理Q4客户清单','按区域整理重点客户',$2,$3,'high','in_progress','assign','2026-10-20',NOW()),
    ($1,'修复报表导出bug','导出Excel乱码',$2,$3,'urgent','submitted','assign','2026-10-08',NOW()),
    ($1,'编写新人培训文档','销售话术+产品知识',null,$3,'medium','market_open','market','2026-10-25',NOW()) ON CONFLICT DO NOTHING`, [t, empE, mgrE]);
  await c.query(`UPDATE work_task SET "rewardPoints"=60 WHERE title='编写新人培训文档'`);
  // 日报
  await c.query(`INSERT INTO report (tenant_id,emp_id,report_type,period_start,period_end,done_part,plan_part,problem_part,related_task_ids,status,created_at)
    VALUES ($1,$2,'daily','2026-10-06','2026-10-06','拜访3家客户，更新商机表','完成Q4清单整理','客户预算未定','[]','submitted',NOW()) ON CONFLICT DO NOTHING`, [t, empE]);
  // HR 待办
  await c.query(`INSERT INTO todo (tenant_id,user_id,biz_type,biz_id,title,action_url,status,created_at) VALUES ($1,$2,'assessment','1','Q4绩效考核：待发布结果','/tasks/1','待处理',NOW()) ON CONFLICT DO NOTHING`, [t, hrU]);
  console.log('DEMO-OK');
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
