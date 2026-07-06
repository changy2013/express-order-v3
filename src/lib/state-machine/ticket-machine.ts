/**
 * 工单状态机
 * 定义合法状态转换和校验逻辑
 */

type TicketStatus = 'pending_approval' | 'level1_approving' | 'level2_approving' | 'executing' | 'completed' | 'rejected' | 'closed';

interface TransitionRule {
  from: TicketStatus[];
  to: TicketStatus;
  action: string;
  description: string;
}

const TRANSITIONS: Record<string, TransitionRule> = {
  submit_approval: {
    from: ['pending_approval'],
    to: 'level1_approving',
    action: 'submit_approval',
    description: '提交审批',
  },
  level1_approve: {
    from: ['level1_approving'],
    to: 'level2_approving', // 金额 > 阈值才需二级，调用方判断后决定走向
    action: 'level1_approve',
    description: '一级审批通过（需二级审批）',
  },
  level1_approve_final: {
    from: ['level1_approving'],
    to: 'executing',
    action: 'level1_approve_final',
    description: '一级审批通过（最终）',
  },
  level1_reject: {
    from: ['level1_approving'],
    to: 'pending_approval',
    action: 'level1_reject',
    description: '一级审批拒绝',
  },
  level2_approve: {
    from: ['level2_approving'],
    to: 'executing',
    action: 'level2_approve',
    description: '二级审批通过',
  },
  level2_reject: {
    from: ['level2_approving'],
    to: 'pending_approval',
    action: 'level2_reject',
    description: '二级审批拒绝',
  },
  escalate_timeout: {
    from: ['pending_approval', 'level1_approving'],
    to: 'level2_approving',
    action: 'escalate_timeout',
    description: '超时自动升级二级审批',
  },
  timeout_reject: {
    from: ['level2_approving'],
    to: 'closed',
    action: 'timeout_reject',
    description: '超时自动驳回关闭',
  },
  execute_complete: {
    from: ['executing'],
    to: 'completed',
    action: 'execute_complete',
    description: '执行完成',
  },
  close_after_reject: {
    from: ['pending_approval'],
    to: 'closed',
    action: 'close_after_reject',
    description: '超过重提次数关闭',
  },
};

export class TicketStateMachine {
  /**
   * 检查是否允许指定的状态转换
   */
  static canTransition(from: TicketStatus, action: string): TransitionRule | null {
    const rule = TRANSITIONS[action];
    if (!rule) return null;
    if (!rule.from.includes(from)) return null;
    return rule;
  }

  /**
   * 根据当前状态和动作计算下一状态
   */
  static getNextStatus(from: TicketStatus, action: string, needLevel2?: boolean): TicketStatus | null {
    const rule = this.canTransition(from, action);
    if (!rule) return null;

    // 一级审批通过时，根据金额判断走向
    if (action === 'level1_approve') {
      return needLevel2 ? 'level2_approving' : 'executing';
    }

    return rule.to;
  }

  /**
   * 获取当前状态下所有合法的动作
   */
  static getValidActions(status: TicketStatus): string[] {
    return Object.entries(TRANSITIONS)
      .filter(([_, rule]) => rule.from.includes(status))
      .map(([action]) => action);
  }

  /**
   * 获取动作的中文描述
   */
  static getActionDescription(action: string): string {
    return TRANSITIONS[action]?.description || action;
  }
}
