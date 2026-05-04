import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
      clinicId: number;
      role: string;
    };
  }

  interface User {
    clinicId: number;
    role: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    clinicId: number;
    role: string;
  }
}