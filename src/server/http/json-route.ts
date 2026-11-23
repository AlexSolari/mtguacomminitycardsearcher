// Answers and `:id` parsing shared by the JSON routes (traders' lists and their moderation).
export const error = (message: string, status: number) =>
    Response.json({ error: message }, { status });
export const noContent = () => new Response(null, { status: 204 });
export const noStore = { 'Cache-Control': 'no-store' };

// A route's `:id`, when it's one a row could have.
export const rowId = (id: string) => {
    const n = Number(id);
    return /^\d{1,15}$/.test(id) && n > 0 ? n : null;
};
