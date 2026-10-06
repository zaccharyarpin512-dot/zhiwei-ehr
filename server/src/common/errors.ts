// 统一业务错误：PRD 9.1 错误码体系（0 成功 / 4xxxx 业务 / 5xxxx 系统）
export class BusinessError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly httpStatus = 400,
  ) {
    super(message);
  }
}

export const Errors = {
  UNAUTHORIZED: () => new BusinessError(40100, '未登录或凭证无效', 401),
  FORBIDDEN: (msg = '无权操作') => new BusinessError(40300, msg, 403),
  NOT_FOUND: (msg = '资源不存在') => new BusinessError(40400, msg, 404),
  WEIGHT_NOT_100: () => new BusinessError(40001, '权重合计必须为100%'),
  DEPT_HAS_CHILDREN_OR_EMP: (n: number) => new BusinessError(40900, `请先处理 ${n} 名在职员工及其子部门`, 409),
  MANAGER_CYCLE: () => new BusinessError(40901, '汇报上级形成环，保存被拒绝', 409),
  OWNER_DEPT_REQUIRED: () => new BusinessError(40010, '数据来源为部门出数时必须选出数部门'),
  CUMULATIVE_FROM_REQUIRED: () => new BusinessError(40011, '口径为自定义累计时必须选累计起点'),
  MOBILE_DUPLICATED: () => new BusinessError(40902, '手机号已存在', 409),
  TOO_MANY_FILLERS: () => new BusinessError(40012, '每个出数部门最多设置 2 名填报人'),
};
