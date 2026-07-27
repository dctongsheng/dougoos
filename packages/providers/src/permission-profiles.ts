import type { PermissionEnforcement, PermissionProfileDescriptor } from "@dougoos/shared";

export function requireDeclaredPermissionProfile(
  profiles: readonly PermissionProfileDescriptor[],
  profileId: string,
): PermissionProfileDescriptor {
  const profile = profiles.find((candidate) => candidate.id === profileId);
  if (profile === undefined) {
    throw new Error("Permission profile is not declared by this Provider");
  }
  return profile;
}

export function defaultPermissionEnforcement(
  profiles: readonly PermissionProfileDescriptor[],
  defaultProfileId: string,
): PermissionEnforcement {
  return requireDeclaredPermissionProfile(profiles, defaultProfileId).permissionEnforcement;
}
