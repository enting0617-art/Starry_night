import { CalendarDays } from 'lucide-react';

function proposalStatus(message, index) {
  return message.calendarProposalStatuses?.[index] || 'pending';
}

function formatDate(value, timeZone) {
  try { return new Date(value).toLocaleString('zh-CN', { timeZone }); } catch { return new Date(value).toLocaleString('zh-CN'); }
}

export default function CalendarProposalGroup({ message, onConfirm, onConfirmAll, onDismiss }) {
  const proposals = message.calendarProposals || [];
  if (!proposals.length) return null;
  const actionable = proposals.map((proposal, index) => ({ proposal, index, status: proposalStatus(message, index) }))
    .filter((item) => item.status === 'pending' || item.status === 'error');
  return <section className="calendar-proposal-group">
    <header><div><CalendarDays size={18} /><span><strong>{proposals.length} 条日程草案</strong><small>可以分别确认，也可以一次全部写入日历</small></span></div>{actionable.length > 1 && <button type="button" className="calendar-confirm-all" onClick={() => onConfirmAll(actionable)} disabled={message.calendarBatchSaving}>{message.calendarBatchSaving ? '正在全部创建…' : `全部确认（${actionable.length}）`}</button>}</header>
    <div className="calendar-proposal-list">{proposals.map((proposal, index) => {
      const status = proposalStatus(message, index);
      if (status === 'dismissed') return null;
      return <article key={`${proposal.title}-${proposal.startAt}-${index}`} className={`calendar-proposal ${status}`}>
        <header><CalendarDays size={17} /><div><strong>{proposal.title}</strong><span>{status === 'created' ? '已写入星空日历' : status === 'saving' ? '正在创建…' : status === 'error' ? '创建失败，可重试' : '等待你确认'}</span></div></header>
        <p>{proposal.kind === 'deadline' ? `截止：${formatDate(proposal.startAt, proposal.timezone)}` : `${formatDate(proposal.startAt, proposal.timezone)} — ${formatDate(proposal.endAt, proposal.timezone)}`}</p>
        {proposal.description && <small>{proposal.description}</small>}
        <small>{proposal.remindBeforeMinutes === null ? '不提醒' : proposal.remindBeforeMinutes === 0 ? '开始时提醒' : `提前 ${proposal.remindBeforeMinutes} 分钟提醒`} · {proposal.timezone}</small>
        {message.calendarProposalErrors?.[index] && <em>{message.calendarProposalErrors[index]}</em>}
        {status !== 'created' && <footer><button type="button" onClick={() => onDismiss(index)} disabled={status === 'saving' || message.calendarBatchSaving}>暂不创建</button><button type="button" className="confirm" onClick={() => onConfirm(index, proposal)} disabled={status === 'saving' || message.calendarBatchSaving}>{status === 'error' ? '重试创建' : '确认创建'}</button></footer>}
      </article>;
    })}</div>
  </section>;
}
