const formatUptime = (startedAt: string): string => {
  const startTime = new Date(startedAt).getTime();

  // Validate input date
  if (isNaN(startTime)) {
    return "Invalid date";
  }

  const uptime = Date.now() - startTime;

  // Return N/A for negative uptime (future dates)
  if (uptime <= 0) {
    return "N/A";
  }

  const seconds = Math.floor((uptime / 1000) % 60);
  const minutes = Math.floor((uptime / 1000 / 60) % 60);
  const hours = Math.floor((uptime / 1000 / 60 / 60) % 24);
  const days = Math.floor(uptime / 1000 / 60 / 60 / 24); // Fixed: was hardcoded to 1

  // Helper function for pluralization
  const pluralize = (value: number, unit: string): string =>
    `${value} ${unit}${value === 1 ? "" : "s"}`;

  if (days > 0) {
    return `${pluralize(days, "day")}, ${hours}h:${minutes
      .toString()
      .padStart(2, "0")}m`;
  } else if (hours > 0) {
    return `${hours}h:${minutes.toString().padStart(2, "0")}m`;
  } else if (minutes > 0) {
    return `${pluralize(minutes, "min")} ${pluralize(seconds, "sec")}`;
  } else {
    return pluralize(seconds, "second");
  }
};

export default formatUptime;
