import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), range: vi.fn(), remove: vi.fn(),
}))
vi.mock("@/lib/supabase", () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
}))
import { deleteDataset, getDatasetDependencies, listDatasetSummaries, listDatasets } from "./datasets"

const query = {
  select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(), range: mocks.range, delete: mocks.remove,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.from.mockReturnValue(query)
  mocks.rpc.mockReturnValue(query)
  mocks.remove.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
})

describe("dataset queries", () => {
  it("fetches catalog summaries without transferring payloads, with pagination lookahead", async () => {
    mocks.range.mockResolvedValue({ data: [{ id: "row" }], error: null })
    const rows = await listDatasetSummaries("flow", 2, 50, true)
    expect(rows).toEqual([{ id: "row" }])
    expect(query.select).toHaveBeenCalledWith("id,type,name,description,created_by,visibility,created_at")
    expect(query.eq).toHaveBeenCalledWith("type", "flow")
    expect(mocks.range).toHaveBeenCalledWith(100, 150)
  })

  it("loads only reachable dependencies, including more than one server page", async () => {
    mocks.range.mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, i) => ({ id: `${i}` })), error: null })
      .mockResolvedValueOnce({ data: [{ id: "last" }], error: null })
    const rows = await getDatasetDependencies("root")
    expect(rows).toHaveLength(501)
    expect(mocks.rpc).toHaveBeenCalledWith("dataset_dependencies", { p_dataset_id: "root" })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.range.mock.calls).toEqual([[0, 499], [500, 999]])
  })

  it("does not truncate full datasets used by exports at the server's row limit", async () => {
    mocks.range.mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, i) => ({ id: `${i}` })), error: null })
      .mockResolvedValueOnce({ data: [], error: null })
    expect(await listDatasets("model")).toHaveLength(500)
    expect(mocks.range.mock.calls).toEqual([[0, 499], [500, 999]])
  })

  it("reports a protected delete as a useful user-facing error", async () => {
    mocks.remove.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: { code: "23503" } }) })
    await expect(deleteDataset("used-flow")).rejects.toThrow("Remove those references before deleting")
  })

  it("propagates dependency lookup failures instead of showing incomplete data", async () => {
    const error = { code: "42501", message: "Denied" }
    mocks.range.mockResolvedValue({ data: null, error })
    await expect(getDatasetDependencies("root")).rejects.toBe(error)
  })
})
