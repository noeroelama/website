export const noRatification = {
  appointments: { getRoleMap: () => Promise.resolve(null) },
  units: { get: () => Promise.resolve(null) },
  roles: { getMany: () => Promise.resolve(new Map()) },
  hasSecondFactor: () => Promise.resolve(true),
  afterRoleChange: () => Promise.resolve(),
  notify: () => Promise.resolve(),
};
