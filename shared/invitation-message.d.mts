export function invitationMessage(input: {
  origin: string;
  code: string;
  expires: number;
  signupImageCredits?: number;
}): string;
