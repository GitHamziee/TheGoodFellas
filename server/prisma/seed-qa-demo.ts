import "dotenv/config";
import bcrypt from "bcrypt";
import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Demo data for the QA Reports pages — ~8 weeks of Junior Closer / Closer QA activity with
 * believable shape: one junior improving, one slipping, repeat live-call offenders, a QA
 * backlog with a few stale leads. Additive and idempotent: everything lives under the
 * `demo-qa-*` id namespace (re-running replaces it) and nothing else is touched.
 *
 *   npm run db:seed:qa-demo        (password for any new account: Password1)
 */
const prisma = new PrismaClient();
const DAY = 86_400_000;

// Small deterministic PRNG so every run produces the same dataset.
let seed = 20260101;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const daysAgo = (d: number) => new Date(Date.now() - d * DAY);

async function upsertUser(email: string, name: string, role: "JUNIOR_CLOSER" | "CLOSER" | "QA_JUNIOR_CLOSER" | "QA_CLOSER") {
  const password = await bcrypt.hash("Password1", 10);
  return prisma.user.upsert({ where: { email }, update: {}, create: { email, name, password, role } });
}

const FIRST = ["Ruth", "Marvin", "Estelle", "Otis", "Wanda", "Clifford", "Lorraine", "Hector", "Bernice", "Delbert", "Iris", "Roosevelt", "Gloria", "Alvin", "Nadine", "Curtis", "Yolanda", "Leonard", "Priscilla", "Hollis", "Vernon", "Opal", "Sylvia", "Grady", "Mavis", "Floyd", "Doris", "Walter", "Edna", "Chester"];
const LAST = ["Callahan", "Tate", "Boyd", "Freeman", "Pierce", "Nunez", "Diaz", "Barnes", "Hollis", "Cruz", "Mendoza", "Kim", "Whitfield", "Sutton", "Beckett", "Vaughn", "Reese", "Frost", "Gage", "Barrett", "Cade", "Bridges", "Monroe", "Lawson", "Ortiz", "Hayes", "Greene", "Powell", "Rhodes", "Stone"];
const STATES: [string, string][] = [["OK", "73101"], ["MI", "48201"], ["AL", "35203"], ["TN", "38103"], ["LA", "70112"], ["AZ", "85004"], ["TX", "77002"], ["FL", "33101"], ["GA", "30303"], ["KY", "40202"], ["OH", "44113"], ["MO", "64106"]];
const STATUSES = ["SUBMITTED", "ASSIGNED", "ACCEPTED", "ACCEPTED", "REJECTED"] as const;

const JUNIOR_FAILS = [
  "Phone number transposed a digit — confirm with the customer before enrichment.",
  "Skipped the smoker question — had to be redialed.",
  "Date of birth doesn't match the age entered.",
  "Customer never gave consent to be recorded; flagging for compliance.",
  "Wrong state selected for the zipcode.",
];
const JUNIOR_PASSES = ["Clean intake, nothing to flag.", "Good notes, all required fields captured.", "", "Solid intake — callback time noted.", ""];
const CLOSER_FAILS = [
  "Routing number failed checksum — send back for correction before it reaches billing.",
  "Beneficiary relationship missing.",
  "Coverage amount doesn't match the quote on the recording.",
  "Health conditions understated versus what the customer said on the call.",
  "Premium entered doesn't match the carrier's rate table.",
];
const CLOSER_PASSES = ["Enrichment complete and consistent with the recorded call.", "Banking details verified.", "", "Everything lines up with the recording.", ""];
const CALL_ISSUES = [
  "Skipped the smoker question — call had to be redialed.",
  "Rushed through the health questions, customer had to repeat an answer.",
  "Did not read the beneficiary disclosure required by the carrier.",
  "Talked over the customer during objection handling.",
  "Quoted a premium before confirming eligibility.",
  "Didn't confirm banking details on the recorded line.",
  "Pressured the customer after they asked to think it over.",
];

/** Pass probability by how many weeks ago — lets a person improve or slip over time. */
type Curve = (weeksAgo: number) => number;
const steady = (p: number): Curve => () => p;
const improving: Curve = (w) => 0.45 + (7 - w) * 0.07; // 0.45 → 0.94
const slipping: Curve = (w) => 0.94 - (7 - w) * 0.07;

async function main() {
  // ─── People: top up the roster so the report has a realistic spread ───
  const j1 = await upsertUser("junior@thegoodfellas.dev", "Jamie Junior", "JUNIOR_CLOSER");
  const j2 = await upsertUser("junior2@thegoodfellas.dev", "Priya Naz", "JUNIOR_CLOSER");
  const j3 = await upsertUser("junior3@thegoodfellas.dev", "Sana Malik", "JUNIOR_CLOSER");
  const j4 = await upsertUser("junior4@thegoodfellas.dev", "Omar Khan", "JUNIOR_CLOSER");
  const c1 = await upsertUser("closer@thegoodfellas.dev", "Casey Closer", "CLOSER");
  const c2 = await upsertUser("closer2@thegoodfellas.dev", "Bilal Ahmed", "CLOSER");
  const c3 = await upsertUser("closer3@thegoodfellas.dev", "Dana Reyes", "CLOSER");
  const qaJ1 = await upsertUser("qa.junior@thegoodfellas.dev", "Quinn Abara", "QA_JUNIOR_CLOSER");
  const qaJ2 = await upsertUser("qa.junior2@thegoodfellas.dev", "Nadia Qureshi", "QA_JUNIOR_CLOSER");
  const qaC1 = await upsertUser("qa.closer@thegoodfellas.dev", "Quentin Ashby", "QA_CLOSER");
  const qaC2 = await upsertUser("qa.closer2@thegoodfellas.dev", "Rafay Siddiqui", "QA_CLOSER");

  const juniors: { user: { id: string }; volume: number; curve: Curve }[] = [
    { user: j1, volume: 3, curve: improving },
    { user: j2, volume: 3, curve: slipping },
    { user: j3, volume: 2, curve: steady(0.85) },
    { user: j4, volume: 2, curve: steady(0.6) },
  ];
  const closers: { user: { id: string }; curve: Curve }[] = [
    { user: c1, curve: steady(0.9) },
    { user: c2, curve: slipping },
    { user: c3, curve: improving },
  ];

  // Wipe our previous run only.
  await prisma.leadReview.deleteMany({ where: { id: { startsWith: "demo-qa-" } } });
  await prisma.callReview.deleteMany({ where: { id: { startsWith: "demo-qa-" } } });
  await prisma.lead.deleteMany({ where: { id: { startsWith: "demo-qa-" } } });

  // ─── Leads + QA verdicts, spread over the last 8 weeks ───
  // Leads each person worked, so live-call issues can point at a real one.
  const leadsByPerson = new Map<string, { id: string; createdDaysAgo: number }[]>();
  const remember = (personId: string, id: string, createdDaysAgo: number) =>
    leadsByPerson.set(personId, [...(leadsByPerson.get(personId) ?? []), { id, createdDaysAgo }]);
  let n = 0;
  let reviews = 0;
  let pending = 0;
  const backdate: { table: "Lead" | "LeadReview"; id: string; at: Date }[] = [];

  for (let weeksAgo = 7; weeksAgo >= 0; weeksAgo--) {
    for (const jr of juniors) {
      for (let k = 0; k < jr.volume + Math.floor(rand() * 2); k++) {
        n += 1;
        const id = `demo-qa-lead-${String(n).padStart(3, "0")}`;
        const closer = pick(closers);
        const [state, zipcode] = pick(STATES);
        const createdDaysAgo = weeksAgo * 7 + Math.floor(rand() * 6.5);
        const created = daysAgo(createdDaysAgo);

        await prisma.lead.create({
          data: {
            id,
            juniorCloserId: jr.user.id,
            closerId: closer.user.id,
            customerName: `${pick(FIRST)} ${pick(LAST)}`,
            phone: `${300 + Math.floor(rand() * 600)}555${String(1000 + Math.floor(rand() * 8999))}`,
            state,
            zipcode,
            age: 62 + Math.floor(rand() * 18),
            need: pick(["BURIAL", "CREMATION", "LEAVE_MONEY"] as const),
            status: pick(STATUSES),
          },
        });
        backdate.push({ table: "Lead", id, at: created });
        remember(jr.user.id, id, createdDaysAgo);
        remember(closer.user.id, id, createdDaysAgo);

        // Junior-intake review. The newest few days are left unreviewed so there's a live
        // backlog, plus a handful of old stragglers that QA never got to.
        const leaveForBacklog = createdDaysAgo <= 3 || (createdDaysAgo > 14 && rand() < 0.07);
        if (leaveForBacklog) {
          pending += 1;
        } else {
          const pass = rand() < jr.curve(weeksAgo);
          const reviewId = `demo-qa-review-j-${id}`;
          const reviewer = rand() < 0.62 ? qaJ1 : qaJ2;
          await prisma.leadReview.create({
            data: {
              id: reviewId,
              leadId: id,
              reviewerId: reviewer.id,
              role: "QA_JUNIOR_CLOSER",
              outcome: pass ? "PASS" : "FAIL",
              comment: pass ? pick(JUNIOR_PASSES) || null : pick(JUNIOR_FAILS),
            },
          });
          backdate.push({ table: "LeadReview", id: reviewId, at: new Date(created.getTime() + (0.3 + rand() * 4) * DAY) });
          reviews += 1;
        }

        // Closer-enrichment review on roughly three quarters of leads.
        if (createdDaysAgo > 4 && rand() < 0.75) {
          const pass = rand() < closer.curve(weeksAgo);
          const reviewId = `demo-qa-review-c-${id}`;
          const reviewer = rand() < 0.55 ? qaC1 : qaC2;
          await prisma.leadReview.create({
            data: {
              id: reviewId,
              leadId: id,
              reviewerId: reviewer.id,
              role: "QA_CLOSER",
              outcome: pass ? "PASS" : "FAIL",
              comment: pass ? pick(CLOSER_PASSES) || null : pick(CLOSER_FAILS),
            },
          });
          backdate.push({ table: "LeadReview", id: reviewId, at: new Date(created.getTime() + (1 + rand() * 5) * DAY) });
          reviews += 1;
        }
      }
    }
  }

  // ─── Live-call issues: a couple of repeat offenders, a couple of clean people ───
  const issueWeights: [{ id: string }, number][] = [
    [j2, 4], [j4, 3], [j1, 1], [j3, 0], // juniors
    [c2, 4], [c3, 2], [c1, 0], // closers
  ];
  let calls = 0;
  for (const [person, perWeek] of issueWeights) {
    for (let weeksAgo = 7; weeksAgo >= 0; weeksAgo--) {
      // Offenders trend up toward the present so the "repeat in 30d" tile has someone in it.
      const count = perWeek === 0 ? 0 : Math.max(0, Math.round(perWeek * (0.4 + (7 - weeksAgo) * 0.12) * (0.6 + rand() * 0.8)) - (perWeek === 1 ? 1 : 0));
      for (let i = 0; i < count; i++) {
        calls += 1;
        const isJunior = [j1.id, j2.id, j3.id, j4.id].includes(person.id);
        const reviewer = isJunior ? (rand() < 0.5 ? qaJ1 : qaJ2) : rand() < 0.5 ? qaC1 : qaC2;
        const id = `demo-qa-call-${String(calls).padStart(3, "0")}`;
        const issueDaysAgo = weeksAgo * 7 + Math.floor(rand() * 6.5);
        // ~85% of flagged calls are tied to a lead the person worked around that time
        // (a call can predate any lead, so the rest stay unlinked).
        const mine = leadsByPerson.get(person.id) ?? [];
        const nearby = mine.filter((l) => l.createdDaysAgo >= issueDaysAgo - 3 && l.createdDaysAgo <= issueDaysAgo + 7);
        const linked = rand() < 0.85 ? pick(nearby.length ? nearby : mine.length ? mine : [null]) : null;
        await prisma.callReview.create({
          data: { id, reviewerId: reviewer.id, revieweeId: person.id, leadId: linked?.id ?? null, comment: pick(CALL_ISSUES) },
        });
        await prisma.$executeRaw(
          Prisma.sql`UPDATE "CallReview" SET "createdAt" = ${daysAgo(issueDaysAgo)} WHERE id = ${id}`,
        );
      }
    }
  }

  // Prisma owns createdAt, so backdate in SQL afterwards (same trick as seed.ts).
  for (const b of backdate) {
    if (b.table === "Lead") {
      await prisma.$executeRaw(Prisma.sql`UPDATE "Lead" SET "createdAt" = ${b.at}, "updatedAt" = ${b.at} WHERE id = ${b.id}`);
    } else {
      await prisma.$executeRaw(Prisma.sql`UPDATE "LeadReview" SET "createdAt" = ${b.at} WHERE id = ${b.id}`);
    }
  }

  console.log(`Seeded ${n} leads, ${reviews} QA reviews (${pending} junior-lane leads left awaiting QA), ${calls} live-call issues`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
