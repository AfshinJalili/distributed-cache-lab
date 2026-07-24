import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { isFaultName } from '@dcl/contracts'
import { AdvanceClockDto, PatchSettingsDto, SetFaultDto } from './dto'
import { LabService } from './lab.service'

@ApiTags('lab controls')
@Controller('lab')
export class LabController {
  constructor(private readonly lab: LabService) {}

  @Get('state')
  @ApiOperation({ summary: 'Read the complete observable lab state' })
  state() {
    return this.lab.state()
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Change the shared cache policy' })
  settings(@Body() body: PatchSettingsDto) {
    return this.lab.patchSettings(body)
  }

  @Post('clock/advance')
  @ApiOperation({ summary: 'Advance the shared logical clock' })
  advance(@Body() body: AdvanceClockDto) {
    return this.lab.advanceClock(body.seconds)
  }

  @Post('flush')
  @ApiOperation({ summary: 'Flush bounded cache entries' })
  async flush() {
    await this.lab.flush()
    return { ok: true }
  }

  @Post('reset')
  @ApiOperation({ summary: 'Restore deterministic origin, cache, metrics, and clock state' })
  reset() {
    return this.lab.reset()
  }

  @Post('faults/:name')
  @ApiOperation({ summary: 'Enable or clear a Toxiproxy failure drill' })
  async fault(@Param('name') name: string, @Body() body: SetFaultDto) {
    if (!isFaultName(name)) {
      throw new UnprocessableEntityException(`Unknown fault: ${name}`)
    }
    await this.lab.setFault(name, body.enabled)
    return { name, enabled: body.enabled }
  }
}
