import bcrypt from "bcrypt";
import { db } from "./db";
import { users, departments, userDepartments } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { User, UserRole } from "@shared/schema";

const SALT_ROUNDS = 12;

const SUPERADMIN_USERNAME = process.env.ADMIN_USERNAME || "adhielesmana";
const SUPERADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function seedSuperadmin(): Promise<void> {
  try {
    // Remove old "admin" user if it exists and is different from configured username
    if (SUPERADMIN_USERNAME !== "admin") {
      const oldAdmin = await db
        .select()
        .from(users)
        .where(eq(users.username, "admin"));
      
      if (oldAdmin.length > 0) {
        await db.delete(users).where(eq(users.username, "admin"));
        console.log("Removed old 'admin' user");
      }
    }

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.username, SUPERADMIN_USERNAME));

    if (existing.length > 0) {
      console.log("Superadmin already exists");
      return;
    }

    const hashedPassword = await hashPassword(SUPERADMIN_PASSWORD);

    await db.insert(users).values({
      username: SUPERADMIN_USERNAME,
      password: hashedPassword,
      role: "superadmin",
      displayName: "Super Administrator",
      isActive: true,
      isDeletable: false,
    });

    console.log("Superadmin created successfully");
  } catch (error) {
    console.error("Error seeding superadmin:", error);
  }
}

export async function seedDefaultDepartment(): Promise<void> {
  try {
    const existing = await db
      .select()
      .from(departments)
      .where(eq(departments.name, "General"));

    if (existing.length > 0) {
      console.log("Default department already exists");
      return;
    }

    await db.insert(departments).values({
      name: "General",
      description: "Default department for all conversations",
    });

    console.log("Default department created");
  } catch (error) {
    console.error("Error seeding default department:", error);
  }
}

export function isAdmin(user: User): boolean {
  return user.role === "superadmin" || user.role === "admin";
}

export function isSuperadmin(user: User): boolean {
  return user.role === "superadmin";
}

export async function getUserDepartmentIds(userId: string, role: UserRole): Promise<string[] | "all"> {
  if (role === "superadmin") {
    return "all";
  }

  const memberships = await db
    .select({ departmentId: userDepartments.departmentId })
    .from(userDepartments)
    .where(eq(userDepartments.userId, userId));

  return memberships.map((m) => m.departmentId);
}
