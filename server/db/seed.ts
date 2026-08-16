import { db } from "./client.js";
import { hashPassword } from "../services/auth.js";
import { ensureSupportIdentifier } from "../services/support-identifiers.js";
import { ensurePrimaryCompatibilityMembership } from "../services/facility-context.js";
import { recordBookingAnalyticsEvent } from "../services/booking-analytics-events.js";

const DEMO_PASSWORDS = {
  admin: "UmbraviaForgeAdmin123",
  trainer: "UmbraviaForgeTrainer123",
  member: "UmbraviaForgeMember123",
} as const;

const ADMIN_USER = {
  id: "admin-1",
  name: "Admin Umbravia Forge",
  email: "admin@umbravia-forge.com",
  phone: "+34953000000",
  password: DEMO_PASSWORDS.admin,
};

const TRAINERS = [
  {
    id: "trainer-1",
    name: "Carlos Martínez",
    email: "carlos@umbravia-forge.com",
    password: DEMO_PASSWORDS.trainer,
  },
  {
    id: "trainer-2",
    name: "Ana García",
    email: "ana@umbravia-forge.com",
    password: DEMO_PASSWORDS.trainer,
  },
  {
    id: "trainer-3",
    name: "Jorge López",
    email: "jorge@umbravia-forge.com",
    password: DEMO_PASSWORDS.trainer,
  },
  {
    id: "trainer-4",
    name: "Sofía Rodríguez",
    email: "sofia@umbravia-forge.com",
    password: DEMO_PASSWORDS.trainer,
  },
];

const CLASS_TYPES = [
  { name: "Yoga Flow", description: "Relaxing yoga session for all levels" },
  {
    name: "HIIT Bootcamp",
    description: "High intensity interval training workout",
  },
  { name: "Pilates Core", description: "Strengthen your core with pilates" },
  { name: "Spinning", description: "Indoor cycling class" },
  { name: "Box Fit", description: "Boxing fitness training" },
  { name: "Zumba", description: "Dance fitness class" },
];

const DEMO_USERS = [
  {
    email: "juan@example.com",
    name: "Juan Pérez",
    password: DEMO_PASSWORDS.member,
    role: "member" as const,
  },
  {
    email: "maria@example.com",
    name: "María González",
    password: DEMO_PASSWORDS.member,
    role: "member" as const,
  },
  {
    email: "carlos@example.com",
    name: "Carlos López",
    password: DEMO_PASSWORDS.member,
    role: "member" as const,
  },
  {
    email: "laura@example.com",
    name: "Laura Fernández",
    password: DEMO_PASSWORDS.member,
    role: "member" as const,
  },
  {
    email: "ana@example.com",
    name: "Ana Martínez",
    password: DEMO_PASSWORDS.member,
    role: "member" as const,
  },
];

async function findSeedUser(id: string, email: string) {
  const byId = await db
    .selectFrom("users")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();

  if (byId) {
    return byId;
  }

  return db
    .selectFrom("users")
    .selectAll()
    .where("email", "=", email)
    .executeTakeFirst();
}

export async function seedDatabase() {
  console.log("Seeding database with demo data...");

  try {
    // Seed admin user
    try {
      const existingAdmin = await findSeedUser(ADMIN_USER.id, ADMIN_USER.email);
      const phoneOwner = await db
        .selectFrom("users")
        .selectAll()
        .where("phone", "=", ADMIN_USER.phone)
        .executeTakeFirst();
      const hashedPassword = await hashPassword(ADMIN_USER.password);
      const availablePhone =
        !phoneOwner || phoneOwner.id === existingAdmin?.id
          ? ADMIN_USER.phone
          : (existingAdmin?.phone ?? null);

      if (existingAdmin) {
        console.log("Updating admin user...");
        await db
          .updateTable("users")
          .set({
            password: hashedPassword,
            role: "admin",
            name: ADMIN_USER.name,
            email: ADMIN_USER.email,
            phone: availablePhone,
          })
          .where("id", "=", existingAdmin.id)
          .execute();
      } else {
        await db
          .insertInto("users")
          .values({
            id: ADMIN_USER.id,
            email: ADMIN_USER.email,
            phone: availablePhone,
            name: ADMIN_USER.name,
            avatarDataUrl: "",
            password: hashedPassword,
            role: "admin",
            sessionIdleTimeoutMinutes: 7 * 24 * 60,
            createdAt: Date.now(),
          })
          .execute();
      }
    } catch (err) {
      console.error(`Error seeding admin user:`, err);
    }

    // Seed trainers
    for (const trainer of TRAINERS) {
      try {
        // Check if user exists
        const existingUser = await findSeedUser(trainer.id, trainer.email);

        const hashedPassword = await hashPassword(trainer.password);

        if (existingUser) {
          // Always update trainers to ensure passwords and roles are correct
          console.log(`Updating trainer ${trainer.email}...`);
          await db
            .updateTable("users")
            .set({
              password: hashedPassword,
              role: "trainer",
              name: trainer.name,
              email: trainer.email,
            })
            .where("id", "=", existingUser.id)
            .execute();
        } else {
          // Insert new trainer
          await db
            .insertInto("users")
            .values({
              id: trainer.id,
              email: trainer.email,
              phone: null,
              name: trainer.name,
              avatarDataUrl: "",
              password: hashedPassword,
              role: "trainer",
              sessionIdleTimeoutMinutes: 7 * 24 * 60,
              createdAt: Date.now(),
            })
            .execute();
        }
      } catch (err) {
        console.error(`Error seeding trainer ${trainer.email}:`, err);
      }
    }

    // Seed members
    for (const user of DEMO_USERS) {
      try {
        const userId = `user-${user.email.split("@")[0]}`;

        // Check if user exists
        const existingUser = await findSeedUser(userId, user.email);

        const hashedPassword = await hashPassword(user.password);

        if (existingUser) {
          // Always update demo users to ensure passwords are correct
          console.log(`Updating user ${user.email}...`);
          await db
            .updateTable("users")
            .set({
              password: hashedPassword,
              role: user.role,
              name: user.name,
              email: user.email,
            })
            .where("id", "=", existingUser.id)
            .execute();
        } else {
          // Insert new user
          await db
            .insertInto("users")
            .values({
              id: userId,
              email: user.email,
              phone: null,
              name: user.name,
              avatarDataUrl: "",
              password: hashedPassword,
              role: user.role,
              sessionIdleTimeoutMinutes: 7 * 24 * 60,
              createdAt: Date.now(),
            })
            .execute();
        }
      } catch (err) {
        console.error(`Error seeding user ${user.email}:`, err);
      }
    }

    const seededUsers = await db.selectFrom("users").select("id").execute();
    await Promise.all(
      seededUsers.map((user) => ensureSupportIdentifier(user.id)),
    );
    const seededRoles = await db
      .selectFrom("users")
      .select(["id", "role", "createdAt"])
      .execute();
    for (const user of seededRoles) {
      await ensurePrimaryCompatibilityMembership(
        user.id,
        user.role,
        user.createdAt,
      );
    }

    // Check if classes already exist
    const existingClasses = await db
      .selectFrom("activitySessions")
      .select("id")
      .limit(1)
      .execute();

    if (existingClasses.length > 0) {
      console.log("Classes already seeded");
      return;
    }

    // Generate classes for the next 7 days
    const now = Date.now();
    const dayInMs = 24 * 60 * 60 * 1000;
    const times = [9, 11, 16, 18, 20]; // 9am, 11am, 4pm, 6pm, 8pm

    let classIndex = 0;
    for (let day = 0; day < 7; day++) {
      const dayStart = now + day * dayInMs;

      for (const hour of times) {
        const classTime = new Date(dayStart);
        classTime.setHours(hour, 0, 0, 0);

        const classData = CLASS_TYPES[classIndex % CLASS_TYPES.length];
        const trainer = TRAINERS[classIndex % TRAINERS.length];
        const maxCapacity = Math.floor(Math.random() * 5) + 15; // 15-20 capacity

        await db
          .insertInto("activitySessions")
          .values({
            id: `class-${day}-${hour}`,
            name: classData.name,
            description: classData.description,
            trainerId: trainer.id,
            trainerName: trainer.name,
            maxCapacity,
            scheduledAt: classTime.getTime(),
          })
          .execute();

        classIndex++;
      }
    }

    // Add some demo bookings
    const classes = await db
      .selectFrom("activitySessions")
      .select(["id"])
      .orderBy("scheduledAt")
      .limit(10)
      .execute();

    for (let i = 0; i < Math.min(3, classes.length); i++) {
      const activitySessionId = classes[i].id;

      for (let j = 0; j < 8; j++) {
        const userEmail = DEMO_USERS[j % DEMO_USERS.length].email;
        const userId = `user-${userEmail.split("@")[0]}`;

        const existingBooking = await db
          .selectFrom("bookings")
          .select("id")
          .where("activitySessionId", "=", activitySessionId)
          .where("userId", "=", userId)
          .where("status", "in", ["confirmed", "waitlist"])
          .executeTakeFirst();

        if (!existingBooking) {
          await db.transaction().execute(async (transaction) => {
            const createdAt = Date.now();
            const bookingId = `booking-${activitySessionId}-${userId}-${i}-${j}`;
            await transaction
              .insertInto("bookings")
              .values({
                id: bookingId,
                activitySessionId,
                userId,
                status: "confirmed",
                createdAt,
                cancelledAt: null,
              })
              .execute();
            await transaction
              .insertInto("bookingLifecycles")
              .values({
                bookingId,
                lifecycleStatus: "confirmation_pending",
                attendanceIntention: "unanswered",
                intentionUpdatedAt: null,
                confirmedAt: null,
                lastReminderAt: null,
                reminderCount: 0,
                updatedAt: createdAt,
              })
              .execute();
            await recordBookingAnalyticsEvent(transaction, {
              bookingId,
              eventType: "booking_created",
              fromState: null,
              toState: "confirmation_pending",
              occurredAt: createdAt,
            });
          });
        }
      }
    }

    const socialUsers = [
      {
        userId: ADMIN_USER.id,
        username: "admin_umbravia",
        bio: "Administración del centro",
      },
      ...TRAINERS.map((trainer) => ({
        userId: trainer.id,
        username: `coach_${trainer.id.split("-")[1]}`,
        bio: "Entrenador verificado",
      })),
      ...DEMO_USERS.map((member) => ({
        userId: `user-${member.email.split("@")[0]}`,
        username: member.email.split("@")[0],
        bio: "Socio de Umbravia Forge",
      })),
    ];
    for (const social of socialUsers) {
      await db
        .insertInto("socialProfiles")
        .values({
          ...social,
          displayRealName: 0,
          birthDate: null,
          privacy: JSON.stringify({
            bio: "facility",
            realName: "private",
            birthYear: "private",
          }),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .onConflict((oc) => oc.column("userId").doNothing())
        .execute();
    }
    for (const channel of [
      { id: "channel-general", name: "General" },
      { id: "channel-announcements", name: "Avisos" },
    ]) {
      await db
        .insertInto("communityChannels")
        .values({
          ...channel,
          scope: "facility",
          scopeId: "primary",
          status: "community_active",
          createdBy: ADMIN_USER.id,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .onConflict((oc) => oc.column("id").doNothing())
        .execute();
    }

    console.log("Database seeded successfully");
  } catch (error) {
    console.error("Error seeding database:", error);
    throw error;
  }
}
