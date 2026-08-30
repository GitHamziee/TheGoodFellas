import "dotenv/config";
import bcrypt from "bcrypt";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PLAN_TYPES = ["LEVEL", "GRADED", "MODIFIED", "GI"] as const;

async function upsertUser(
  email: string,
  name: string,
  role:
    | "JUNIOR_CLOSER"
    | "CLOSER"
    | "ADMIN"
    | "CLIENT"
    | "TEAM_LEAD"
    | "QA_JUNIOR_CLOSER"
    | "QA_CLOSER"
    | "RETENTION",
  pricing?: { levelCost: number; gradedCost: number; modifiedCost: number; giCost: number },
) {
  const password = await bcrypt.hash("Password1", 10);
  return prisma.user.upsert({
    where: { email },
    update: pricing ?? {},
    create: { email, name, password, role, ...pricing },
  });
}

/** Days back from now, as a Date. Keeps the demo data reading as a live pipeline. */
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

type DemoLead = {
  n: number;
  status: "NEW" | "SUBMITTED" | "ASSIGNED" | "ACCEPTED" | "REJECTED" | "ASSIGNED_EXTERNAL";
  customerName: string;
  phone: string;
  state: string;
  zipcode: string;
  age: number;
  need: "BURIAL" | "CREMATION" | "LEAVE_MONEY";
  junior: number;
  closer: number;
  client?: number;
  externalClient?: number;
  createdDaysAgo: number;
  /** Backdated separately — drives the dashboard's "waiting too long" warning. */
  updatedDaysAgo: number;
  coverage?: number;
  premium?: number;
  carrier?: string;
  paid?: boolean;
  rejectionReason?: string;
};

const DEMO_LEADS: DemoLead[] = [
  // — NEW: sitting with a closer, not yet enriched —
  { n: 1, status: "NEW", customerName: "Ruth Callahan", phone: "4055550118", state: "OK", zipcode: "73101", age: 68, need: "BURIAL", junior: 0, closer: 0, createdDaysAgo: 0, updatedDaysAgo: 0 },
  { n: 2, status: "NEW", customerName: "Marvin Tate", phone: "3135550142", state: "MI", zipcode: "48201", age: 72, need: "CREMATION", junior: 1, closer: 1, createdDaysAgo: 0, updatedDaysAgo: 0 },
  { n: 3, status: "NEW", customerName: "Estelle Boyd", phone: "2055550163", state: "AL", zipcode: "35203", age: 65, need: "BURIAL", junior: 0, closer: 2, createdDaysAgo: 1, updatedDaysAgo: 1 },
  { n: 4, status: "NEW", customerName: "Otis Freeman", phone: "9015550177", state: "TN", zipcode: "38103", age: 70, need: "LEAVE_MONEY", junior: 1, closer: 0, createdDaysAgo: 1, updatedDaysAgo: 1 },

  // — SUBMITTED: enriched, waiting on admin to assign (first two deliberately stale) —
  { n: 5, status: "SUBMITTED", customerName: "Wanda Pierce", phone: "5045550191", state: "LA", zipcode: "70112", age: 74, need: "BURIAL", junior: 0, closer: 0, createdDaysAgo: 6, updatedDaysAgo: 5, coverage: 15000, premium: 78, carrier: "Mutual of Omaha" },
  { n: 6, status: "SUBMITTED", customerName: "Clifford Nunez", phone: "6025550204", state: "AZ", zipcode: "85004", age: 66, need: "CREMATION", junior: 1, closer: 1, createdDaysAgo: 5, updatedDaysAgo: 4, coverage: 10000, premium: 54, carrier: "Gerber Life" },
  { n: 7, status: "SUBMITTED", customerName: "Lorraine Diaz", phone: "7135550219", state: "TX", zipcode: "77002", age: 69, need: "BURIAL", junior: 0, closer: 2, createdDaysAgo: 2, updatedDaysAgo: 1, coverage: 20000, premium: 96, carrier: "Foresters" },
  { n: 8, status: "SUBMITTED", customerName: "Hector Barnes", phone: "3055550233", state: "FL", zipcode: "33101", age: 63, need: "LEAVE_MONEY", junior: 1, closer: 0, createdDaysAgo: 1, updatedDaysAgo: 0, coverage: 25000, premium: 112, carrier: "Aetna" },
  { n: 9, status: "SUBMITTED", customerName: "Bernice Hollis", phone: "4045550247", state: "GA", zipcode: "30303", age: 77, need: "BURIAL", junior: 0, closer: 1, createdDaysAgo: 1, updatedDaysAgo: 0, coverage: 12000, premium: 88, carrier: "Royal Neighbors" },

  // — ASSIGNED: offered to a client, awaiting their decision —
  { n: 10, status: "ASSIGNED", customerName: "Delbert Cruz", phone: "5025550251", state: "KY", zipcode: "40202", age: 71, need: "BURIAL", junior: 0, closer: 0, client: 0, createdDaysAgo: 4, updatedDaysAgo: 2, coverage: 18000, premium: 91, carrier: "Mutual of Omaha" },
  { n: 11, status: "ASSIGNED", customerName: "Iris Mendoza", phone: "5205550268", state: "AZ", zipcode: "85701", age: 64, need: "CREMATION", junior: 1, closer: 1, client: 1, createdDaysAgo: 3, updatedDaysAgo: 1, coverage: 10000, premium: 49, carrier: "Gerber Life" },
  { n: 12, status: "ASSIGNED", customerName: "Roosevelt Kim", phone: "2165550272", state: "OH", zipcode: "44113", age: 75, need: "BURIAL", junior: 0, closer: 2, client: 2, createdDaysAgo: 3, updatedDaysAgo: 1, coverage: 15000, premium: 84, carrier: "Foresters" },
  { n: 13, status: "ASSIGNED", customerName: "Gloria Whitfield", phone: "8035550286", state: "SC", zipcode: "29201", age: 68, need: "LEAVE_MONEY", junior: 1, closer: 0, client: 0, createdDaysAgo: 2, updatedDaysAgo: 0, coverage: 30000, premium: 138, carrier: "Aetna" },

  // — ACCEPTED, paid —
  { n: 14, status: "ACCEPTED", customerName: "Alvin Sutton", phone: "3175550294", state: "IN", zipcode: "46204", age: 73, need: "BURIAL", junior: 0, closer: 0, client: 0, createdDaysAgo: 26, updatedDaysAgo: 20, coverage: 20000, premium: 104, carrier: "Mutual of Omaha", paid: true },
  { n: 15, status: "ACCEPTED", customerName: "Nadine Beckett", phone: "6155550308", state: "TN", zipcode: "37201", age: 67, need: "CREMATION", junior: 1, closer: 1, client: 1, createdDaysAgo: 22, updatedDaysAgo: 17, coverage: 12000, premium: 61, carrier: "Gerber Life", paid: true },
  { n: 16, status: "ACCEPTED", customerName: "Curtis Vaughn", phone: "8165550311", state: "MO", zipcode: "64106", age: 70, need: "BURIAL", junior: 0, closer: 0, client: 2, createdDaysAgo: 18, updatedDaysAgo: 14, coverage: 25000, premium: 119, carrier: "Foresters", paid: true },
  { n: 17, status: "ACCEPTED", customerName: "Yolanda Reese", phone: "5045550325", state: "LA", zipcode: "70113", age: 66, need: "LEAVE_MONEY", junior: 1, closer: 2, client: 0, createdDaysAgo: 15, updatedDaysAgo: 11, coverage: 35000, premium: 152, carrier: "Aetna", paid: true },

  // — ACCEPTED, unpaid (the admin's "to collect" bucket) —
  { n: 18, status: "ACCEPTED", customerName: "Leonard Frost", phone: "4145550339", state: "WI", zipcode: "53202", age: 74, need: "BURIAL", junior: 0, closer: 0, client: 0, createdDaysAgo: 12, updatedDaysAgo: 8, coverage: 15000, premium: 87, carrier: "Royal Neighbors" },
  { n: 19, status: "ACCEPTED", customerName: "Priscilla Gage", phone: "6125550342", state: "MN", zipcode: "55401", age: 69, need: "CREMATION", junior: 1, closer: 1, client: 1, createdDaysAgo: 9, updatedDaysAgo: 6, coverage: 10000, premium: 58, carrier: "Gerber Life" },
  { n: 20, status: "ACCEPTED", customerName: "Hollis Barrett", phone: "5025550356", state: "KY", zipcode: "40203", age: 71, need: "BURIAL", junior: 0, closer: 2, client: 2, createdDaysAgo: 7, updatedDaysAgo: 4, coverage: 22000, premium: 108, carrier: "Mutual of Omaha" },

  // — ASSIGNED_EXTERNAL: handed off to an external client, no login/accept-reject —
  { n: 23, status: "ASSIGNED_EXTERNAL", customerName: "Vernon Cade", phone: "3145550399", state: "MO", zipcode: "63101", age: 72, need: "BURIAL", junior: 0, closer: 1, externalClient: 0, createdDaysAgo: 10, updatedDaysAgo: 6, coverage: 15000, premium: 82, carrier: "Mutual of Omaha", paid: true },
  { n: 24, status: "ASSIGNED_EXTERNAL", customerName: "Opal Bridges", phone: "9185550402", state: "OK", zipcode: "74103", age: 67, need: "CREMATION", junior: 1, closer: 2, externalClient: 1, createdDaysAgo: 4, updatedDaysAgo: 2, coverage: 10000, premium: 51, carrier: "Gerber Life" },

  // — REJECTED: sent back to admin to fix and reassign —
  { n: 21, status: "REJECTED", customerName: "Sylvia Monroe", phone: "2145550368", state: "TX", zipcode: "75201", age: 79, need: "BURIAL", junior: 0, closer: 1, createdDaysAgo: 8, updatedDaysAgo: 3, coverage: 15000, premium: 132, carrier: "Foresters", rejectionReason: "Age outside our underwriting band for this carrier." },
  { n: 22, status: "REJECTED", customerName: "Grady Lawson", phone: "9045550371", state: "FL", zipcode: "32202", age: 62, need: "LEAVE_MONEY", junior: 1, closer: 0, createdDaysAgo: 5, updatedDaysAgo: 2, coverage: 40000, premium: 175, carrier: "Aetna", rejectionReason: "Bank details incomplete — routing number failed validation." },
];

async function main() {
  // ─── Accounts ───
  const admin = await upsertUser("admin@thegoodfellas.dev", "Admin User", "ADMIN");
  const junior = await upsertUser("junior@thegoodfellas.dev", "Jamie Junior", "JUNIOR_CLOSER");
  const junior2 = await upsertUser("junior2@thegoodfellas.dev", "Priya Naz", "JUNIOR_CLOSER");
  const closer = await upsertUser("closer@thegoodfellas.dev", "Casey Closer", "CLOSER");
  const closer2 = await upsertUser("closer2@thegoodfellas.dev", "Bilal Ahmed", "CLOSER");
  const closer3 = await upsertUser("closer3@thegoodfellas.dev", "Dana Reyes", "CLOSER");
  // Per-plan lead cost (USD) — each client pays a different rate per plan type.
  const client = await upsertUser("client@thegoodfellas.dev", "Charlie Client", "CLIENT", {
    levelCost: 5_000,
    gradedCost: 4_000,
    modifiedCost: 3_500,
    giCost: 3_000,
  });
  const client2 = await upsertUser("client2@thegoodfellas.dev", "Sunrise Insurance", "CLIENT", {
    levelCost: 6_000,
    gradedCost: 4_500,
    modifiedCost: 4_000,
    giCost: 3_200,
  });
  const client3 = await upsertUser("client3@thegoodfellas.dev", "Legacy Life Group", "CLIENT", {
    levelCost: 5_500,
    gradedCost: 4_200,
    modifiedCost: 3_800,
    giCost: 3_100,
  });
  await upsertUser("teamlead@thegoodfellas.dev", "Taylor Lead", "TEAM_LEAD");
  const qaJunior = await upsertUser("qa.junior@thegoodfellas.dev", "Quinn Abara", "QA_JUNIOR_CLOSER");
  const qaCloser = await upsertUser("qa.closer@thegoodfellas.dev", "Quentin Ashby", "QA_CLOSER");
  // Two accounts (not one) so the cross-edit "filter to a teammate and work their lead"
  // behavior is actually testable without first creating a second account by hand.
  await upsertUser("retention@thegoodfellas.dev", "Riley Retention", "RETENTION");
  await upsertUser("retention2@thegoodfellas.dev", "Rowan Retention", "RETENTION");

  console.log(`Seeded ${14} users — password for all: Password1`);
  console.log(`  admin: ${admin.email}`);

  const juniors = [junior, junior2];
  const closers = [closer, closer2, closer3];
  const clients = [client, client2, client3];

  // ─── External clients ───
  const external1 = await prisma.externalClient.upsert({
    where: { id: "external-client-01" },
    update: {},
    create: {
      id: "external-client-01",
      name: "Frank Odom",
      company: "Heritage Trust Partners",
      email: "frank@heritagetrustpartners.com",
      phone: "6155550410",
      notes: "Handles overflow burial leads in TN/MO. Pays by check, net 15.",
    },
  });
  const external2 = await prisma.externalClient.upsert({
    where: { id: "external-client-02" },
    update: {},
    create: {
      id: "external-client-02",
      name: "Dana Whitcomb",
      company: "Whitcomb Family Insurance",
      email: "dana@whitcombfamily.com",
      phone: "9185550423",
      notes: "Independent broker, referred by Legacy Life Group.",
    },
  });
  const externalClients = [external1, external2];

  console.log(`Seeded 2 external clients`);

  // ─── Demo leads ───
  // Deterministic ids so re-running the seed replaces these rows rather than
  // stacking duplicates. Nothing outside the `demo-lead-*` namespace is touched.
  for (const l of DEMO_LEADS) {
    const id = `demo-lead-${String(l.n).padStart(2, "0")}`;
    const enriched = l.status !== "NEW";

    const data = {
      juniorCloserId: juniors[l.junior].id,
      closerId: closers[l.closer].id,
      clientId: l.client !== undefined ? clients[l.client].id : null,
      externalClientId: l.externalClient !== undefined ? externalClients[l.externalClient].id : null,

      customerName: l.customerName,
      phone: l.phone,
      state: l.state,
      zipcode: l.zipcode,
      age: l.age,
      maritalStatus: l.n % 3 === 0 ? "Married" : l.n % 3 === 1 ? "Widowed" : "Single",
      smoker: l.n % 4 === 0,
      need: l.need,
      incomeSource: "RETIRED" as const,
      retiredIncomeType: l.n % 2 === 0 ? ("SSI" as const) : ("SSDI" as const),
      annualIncome: 18_000 + (l.n % 5) * 3_000,
      juniorNotes: "Answered on the first dial, asked us to call back after 4pm.",

      // Enrichment fields only exist once a closer has actually worked the lead.
      ...(enriched && {
        mailingAddress: `${100 + l.n} Maple Street, ${l.state}`,
        email: `${l.customerName.split(" ")[0].toLowerCase()}@example.com`,
        ssn: `${400 + l.n}-55-${1000 + l.n}`,
        beneficiaryRelation: l.n % 2 === 0 ? "Daughter" : "Son",
        beneficiaryName: l.n % 2 === 0 ? "Alicia Moore" : "Trevor Moore",
        healthConditions: l.n % 3 === 0 ? "Type 2 diabetes, controlled" : "None reported",
        medications: l.n % 3 === 0 ? "Metformin 500mg" : "None",
        carrierName: l.carrier,
        planType: PLAN_TYPES[l.n % PLAN_TYPES.length],
        coverageAmount: l.coverage,
        monthlyPremiums: l.premium,
        payer: "SELF" as const,
        bankName: "Regions Bank",
        accountType: "CHECKING" as const,
        routingNumber: "062000019",
        accountNumber: `00012345${l.n}`,
        closerNotes: "Verified interest and confirmed banking details on a recorded line.",
      }),

      ...(l.rejectionReason && { rejectionReason: l.rejectionReason }),
      paymentStatus: (l.paid ? "PAID" : "UNPAID") as "PAID" | "UNPAID",
      closedAt: l.paid ? daysAgo(l.updatedDaysAgo) : null,
      status: l.status,
    };

    await prisma.lead.upsert({ where: { id }, update: data, create: { id, ...data } });
  }

  // Prisma owns createdAt/updatedAt (@default(now()) / @updatedAt), so it overrides
  // anything passed in. Backdate them in SQL afterwards — otherwise every demo lead
  // looks like it arrived in the same second and the dashboard's ageing signals
  // ("waiting more than N days", "new this month") have nothing to show.
  for (const l of DEMO_LEADS) {
    const id = `demo-lead-${String(l.n).padStart(2, "0")}`;
    await prisma.$executeRaw(
      Prisma.sql`UPDATE "Lead" SET "createdAt" = ${daysAgo(l.createdDaysAgo)}, "updatedAt" = ${daysAgo(l.updatedDaysAgo)} WHERE id = ${id}`,
    );
  }

  const counts = await prisma.lead.groupBy({ by: ["status"], _count: true });
  console.log(`Seeded ${DEMO_LEADS.length} demo leads:`);
  console.log(Object.fromEntries(counts.map((c) => [c.status, c._count])));

  // ─── QA reviews ───
  // A handful of intake reviews (any lead with a junior closer) and enrichment reviews
  // (any lead past NEW/DRAFT with a closer) — enough demo data for the QA queues/history
  // and the admin QA analytics pages to have something to show. Deterministic ids so
  // re-running the seed replaces rather than stacks.
  const juniorReviewTargets = DEMO_LEADS.slice(0, 6);
  const closerReviewTargets = DEMO_LEADS.filter((l) => l.status !== "NEW").slice(0, 6);

  for (const [i, l] of juniorReviewTargets.entries()) {
    const outcome = i % 4 === 0 ? "FAIL" : "PASS";
    const comment = i % 4 === 0 ? "Phone number transposed a digit — confirm with the customer before enrichment." : "Clean intake, nothing to flag.";
    await prisma.leadReview.upsert({
      where: { leadId_role: { leadId: `demo-lead-${String(l.n).padStart(2, "0")}`, role: "QA_JUNIOR_CLOSER" } },
      update: { outcome, comment },
      create: {
        leadId: `demo-lead-${String(l.n).padStart(2, "0")}`,
        reviewerId: qaJunior.id,
        role: "QA_JUNIOR_CLOSER",
        outcome,
        comment,
      },
    });
  }

  for (const [i, l] of closerReviewTargets.entries()) {
    const outcome = i % 5 === 0 ? "FAIL" : "PASS";
    const comment = i % 5 === 0 ? "Routing number failed checksum — send back for correction before it reaches billing." : "Enrichment complete and consistent with the recorded call.";
    await prisma.leadReview.upsert({
      where: { leadId_role: { leadId: `demo-lead-${String(l.n).padStart(2, "0")}`, role: "QA_CLOSER" } },
      update: { outcome, comment },
      create: {
        leadId: `demo-lead-${String(l.n).padStart(2, "0")}`,
        reviewerId: qaCloser.id,
        role: "QA_CLOSER",
        outcome,
        comment,
      },
    });
  }

  // ─── Call reviews — live-call QA issue log, unrelated to any lead. No "pass" side —
  // this only exists to flag something wrong, so every row here is a problem call. ───
  const callReviewSeed: { id: string; reviewer: string; reviewee: string; comment: string }[] = [
    { id: "demo-call-review-01", reviewer: qaJunior.id, reviewee: junior.id, comment: "Skipped the smoker question — call had to be redialed." },
    { id: "demo-call-review-02", reviewer: qaJunior.id, reviewee: junior2.id, comment: "Rushed through the health questions, customer had to be asked to repeat an answer." },
    { id: "demo-call-review-03", reviewer: qaCloser.id, reviewee: closer2.id, comment: "Did not read the beneficiary disclosure required by the carrier." },
  ];
  for (const r of callReviewSeed) {
    await prisma.callReview.upsert({
      where: { id: r.id },
      update: { reviewerId: r.reviewer, revieweeId: r.reviewee, comment: r.comment },
      create: { id: r.id, reviewerId: r.reviewer, revieweeId: r.reviewee, comment: r.comment },
    });
  }

  console.log(`Seeded ${juniorReviewTargets.length} intake reviews, ${closerReviewTargets.length} enrichment reviews, ${callReviewSeed.length} call reviews`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
