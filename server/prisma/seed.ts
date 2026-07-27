import "dotenv/config";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function upsertUser(email: string, name: string, role: "JUNIOR_CLOSER" | "CLOSER" | "ADMIN" | "CLIENT") {
  const password = await bcrypt.hash("Password1", 10);
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, password, role },
  });
}

async function main() {
  const admin = await upsertUser("admin@thegoodfellas.dev", "Admin User", "ADMIN");
  const junior = await upsertUser("junior@thegoodfellas.dev", "Jamie Junior", "JUNIOR_CLOSER");
  const closer = await upsertUser("closer@thegoodfellas.dev", "Casey Closer", "CLOSER");
  const client = await upsertUser("client@thegoodfellas.dev", "Charlie Client", "CLIENT");

  console.log("Seeded users (password for all: Password1):");
  console.log({ admin: admin.email, junior: junior.email, closer: closer.email, client: client.email });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
