import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CreateLeadSchema, LeadFilterSchema } from './schemas.js'

const valid = {
  fullName: 'Ramesh Kumar',
  mobile: '+91 98444 93082',
  loanType: 'personal',
  amount: 600000,
  income: 85000,
  employment: 'salaried',
  consent: true,
  consentText: 'I agree that Loinance may share these details with partner banks.',
}

describe('CreateLeadSchema', () => {
  it('accepts a well-formed submission and normalizes the mobile', () => {
    const result = CreateLeadSchema.safeParse(valid)
    assert.equal(result.success, true)
    assert.equal(result.data?.mobile, '9844493082')
  })

  it('rejects consent that is absent or false — §14, nothing stored', () => {
    for (const consent of [undefined, false, 'true', 1]) {
      const result = CreateLeadSchema.safeParse({ ...valid, consent })
      assert.equal(result.success, false, String(consent))
    }
  })

  it('requires the consent wording, so it can be proved later', () => {
    assert.equal(CreateLeadSchema.safeParse({ ...valid, consentText: '' }).success, false)
    const { consentText: _omitted, ...withoutConsentText } = valid
    assert.equal(CreateLeadSchema.safeParse(withoutConsentText).success, false)
  })

  it('enforces the §7 amount and income bounds', () => {
    assert.equal(CreateLeadSchema.safeParse({ ...valid, amount: 9_999 }).success, false)
    assert.equal(CreateLeadSchema.safeParse({ ...valid, amount: 100_000_001 }).success, false)
    assert.equal(CreateLeadSchema.safeParse({ ...valid, income: 4_999 }).success, false)
    assert.equal(CreateLeadSchema.safeParse({ ...valid, income: 10_000_001 }).success, false)
  })

  it('rejects unknown loan and employment types', () => {
    assert.equal(CreateLeadSchema.safeParse({ ...valid, loanType: 'gold' }).success, false)
    assert.equal(CreateLeadSchema.safeParse({ ...valid, employment: 'retired' }).success, false)
  })

  it('accepts names with the punctuation Indian names actually use', () => {
    for (const fullName of ["D'Souza", 'Rama Rao', 'M. K. Nair', 'Sai-Krishna']) {
      assert.equal(CreateLeadSchema.safeParse({ ...valid, fullName }).success, true, fullName)
    }
  })

  it('rejects a name carrying markup or digits', () => {
    for (const fullName of ['<script>x</script>', 'Ramesh 99', 'a']) {
      assert.equal(CreateLeadSchema.safeParse({ ...valid, fullName }).success, false, fullName)
    }
  })

  it('reports the offending field so the form can highlight it', () => {
    const result = CreateLeadSchema.safeParse({ ...valid, mobile: '12345' })
    assert.equal(result.success, false)
    assert.deepEqual(result.error?.issues[0]?.path, ['mobile'])
  })
})

describe('LeadFilterSchema', () => {
  it('applies the documented defaults', () => {
    const filter = LeadFilterSchema.parse({})
    assert.equal(filter.page, 1)
    assert.equal(filter.pageSize, 25)
    assert.equal(filter.sort, 'created_at:desc')
    assert.equal(filter.includeSuspect, false)
  })

  it('splits csv filters', () => {
    const filter = LeadFilterSchema.parse({ loanType: 'personal,home' })
    assert.deepEqual(filter.loanType, ['personal', 'home'])
  })

  it('rejects an unknown value inside a csv filter', () => {
    assert.equal(LeadFilterSchema.safeParse({ status: 'new,exploded' }).success, false)
  })

  it('caps pageSize at 100 so one request cannot pull the whole table', () => {
    assert.equal(LeadFilterSchema.safeParse({ pageSize: 500 }).success, false)
  })

  it('rejects a non-ISO date', () => {
    assert.equal(LeadFilterSchema.safeParse({ from: '12-08-2026' }).success, false)
  })

  it('rejects a sort column that is not indexed', () => {
    assert.equal(LeadFilterSchema.safeParse({ sort: 'notes:asc' }).success, false)
  })
})
