# -*- coding: utf-8 -*-
# Employee 增加 userId 关联（考核单待办需要 emp→user 映射）
import io
p = 'prisma/schema.prisma'
s = io.open(p, encoding='utf-8').read()
old = """  managerEmpId  BigInt?   @map("manager_emp_id")
  status        EmpStatus @default(ACTIVE)"""
new = """  managerEmpId  BigInt?   @map("manager_emp_id")
  userId        BigInt?   @map("user_id")
  status        EmpStatus @default(ACTIVE)"""
assert old in s
io.open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
print('employee.userId added')
