import { clean, hash, now } from './util.mjs';

export function decisionProfile(profile){
  if(!profile)return null;
  return {preferences:profile.preferences.filter(p=>!['rejected','superseded','needs_review'].includes(p.status)),rejectedInterpretations:profile.preferences.filter(p=>p.status==='rejected').map(p=>({id:p.id,statement:p.statement,meaning:'用户认为这条推断不准确；不能作为偏好，也不要机械推断其反面。'})),pendingConflicts:profile.preferences.filter(p=>p.status==='needs_review').map(p=>({id:p.id,statement:p.statement,supersedes:p.supersedes})),updated:profile.updated};
}
export function mergePreferences(output,previous,evidence){
  const allowed=new Map(evidence.map(e=>[e.id,e])),old=new Map((previous?.preferences||[]).map(p=>[p.id,p]));
  const retainedStatuses=['accepted','rejected','superseded','needs_review'];
  const kept=new Map([...old].filter(([,p])=>retainedStatuses.includes(p.status)));
  for(const item of (output||[]).slice(0,15)){
    if(!item.statement||!Array.isArray(item.evidenceIds)||!item.evidenceIds.some(e=>allowed.has(e)))continue;
    const prior=old.get(item.existingPreferenceId)||[...old.values()].find(p=>p.statement===item.statement);
    // User feedback persists by identity, independently of how the model rephrases a statement.
    if(prior&&item.relation!=='conflict'&&retainedStatuses.includes(prior.status)){kept.set(prior.id,prior);continue;}
    const relatedRejection=[...old.values()].find(p=>p.status==='rejected'&&(p.evidenceIds||[]).some(id=>item.evidenceIds.includes(id)));
    const needsReview=item.relation==='conflict'||!!relatedRejection;
    const pref={id:prior&&!needsReview?prior.id:hash(item.statement).slice(0,16),statement:clean(item.statement),category:clean(item.category),confidence:Math.max(0,Math.min(1,Number(item.confidence)||0)),evidenceIds:item.evidenceIds.filter(e=>allowed.has(e)),evidenceQuote:clean(item.evidenceQuote),quoteVerified:item.evidenceIds.some(e=>allowed.get(e)?.text.includes(item.evidenceQuote)&&item.evidenceQuote.length>2),status:needsReview?'needs_review':'inferred',...(needsReview?{supersedes:prior?.id||relatedRejection?.id,reviewReason:'与既有反馈存在关联或冲突，尚未作为生效偏好。'}:{})};
    if(kept.has(pref.id)&&retainedStatuses.includes(kept.get(pref.id).status))pref.id=hash(pref.id+JSON.stringify(pref.evidenceIds)+now()).slice(0,16);
    kept.set(pref.id,pref);
  }
  return [...kept.values()];
}
