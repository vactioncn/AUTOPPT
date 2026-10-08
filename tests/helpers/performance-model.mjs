export function mockGlobalPlan(input) {
  if (!["planning", "consolidation"].includes(input.stage)) return null;
  return {
    overview: "先讲故事，再推进论点，最后平稳收束。",
    sections: [
      {
        startPage: input.pageStart,
        endPage: input.pageEnd,
        direction: "保持自然连贯，在转折处留出思考时间。",
      },
    ],
  };
}
export function mockDelivery(input) {
  return {
    units: input.units.map((u) => ({
      id: u.id,
      emotion: "calm",
      pace: 1,
      pauseAfter: 0,
      emphasis: false,
      sound: "",
      reason: "",
    })),
  };
}
