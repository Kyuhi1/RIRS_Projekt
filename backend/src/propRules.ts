// Preverjanje pravil financiranega računa iz dnevne krivulje vrednosti (US-08). Definicije so v README
// (poglavje »Pravila financiranega računa«). Funkcija je čista: ne zna ustaviti testa, krivulja je vedno celotna.
import type { EquityPoint } from './simulation.ts';

export interface PropPlan {
  accountSize: number; // začetno stanje računa; test se izvede s tem kapitalom
  profitTarget: number;
  maxDailyLoss: number;
  maxTotalLoss: number;
}

export interface RuleResult {
  achieved: number; // dosežen znesek (dobiček pri cilju, največja izguba pri omejitvah), zaokrožen na centa
  allowed: number; // zahtevan oziroma dovoljen znesek iz načrta
  passed: boolean; // Izpolnjeno (true) ali Kršeno (false)
  firstViolation: string | null; // YYYY-MM-DD prve kršitve; pri cilju dobička vedno null
}

export interface ChallengeResult {
  passed: boolean; // true samo, če so izpolnjena vsa tri pravila
  profitTarget: RuleResult;
  maxDailyLoss: RuleResult;
  maxTotalLoss: RuleResult;
}

const cents = (value: number) => Math.round(value * 100) / 100;

export function checkChallenge(plan: PropPlan, curve: EquityPoint[]): ChallengeResult {
  const start = plan.accountSize;
  let previous = start;
  let worstDaily = 0;
  let worstTotal = 0;
  let dailyViolation: string | null = null;
  let totalViolation: string | null = null;

  for (const point of curve) {
    const daily = cents(previous - point.value); // izguba tega dneva glede na stanje ob koncu prejšnjega
    const total = cents(start - point.value); // izguba glede na začetno stanje računa
    worstDaily = Math.max(worstDaily, daily);
    worstTotal = Math.max(worstTotal, total);
    if (dailyViolation === null && daily > plan.maxDailyLoss) dailyViolation = point.date;
    if (totalViolation === null && total > plan.maxTotalLoss) totalViolation = point.date;
    previous = point.value;
  }

  const profit = cents((curve.length > 0 ? curve[curve.length - 1]!.value : start) - start);
  const profitTarget: RuleResult = { achieved: profit, allowed: plan.profitTarget, passed: profit >= plan.profitTarget, firstViolation: null };
  const maxDailyLoss: RuleResult = { achieved: worstDaily, allowed: plan.maxDailyLoss, passed: dailyViolation === null, firstViolation: dailyViolation };
  const maxTotalLoss: RuleResult = { achieved: worstTotal, allowed: plan.maxTotalLoss, passed: totalViolation === null, firstViolation: totalViolation };
  return { passed: profitTarget.passed && maxDailyLoss.passed && maxTotalLoss.passed, profitTarget, maxDailyLoss, maxTotalLoss };
}
