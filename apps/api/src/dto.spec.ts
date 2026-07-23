import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { PatchSettingsDto } from './dto'

describe('PatchSettingsDto', () => {
  it('accepts bounded production-safe lab settings', async () => {
    const dto = plainToInstance(PatchSettingsDto, {
      ttlSeconds: 30,
      capacity: 4,
      eviction: 'LFU',
      coalescing: false,
    })
    await expect(validate(dto)).resolves.toEqual([])
  })

  it('rejects an unbounded capacity and unknown write policy', async () => {
    const dto = plainToInstance(PatchSettingsDto, {
      capacity: 1000,
      writePolicy: 'hope-for-the-best',
    })
    const errors = await validate(dto)
    expect(errors.map((error) => error.property).sort()).toEqual(['capacity', 'writePolicy'])
  })
})
