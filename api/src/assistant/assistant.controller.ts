import { Body, Controller, HttpCode, NotFoundException, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ChatBody, TranslateBody } from './assistant.dto';
import { AssistantService } from './assistant.service';

// Every call costs money, so the per-address limit is much lower than for the rest of the API.
const LIMIT = { default: { limit: 8, ttl: 60_000 } };

@ApiTags('assistant')
@Controller()
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('stories/:id/chat')
  @HttpCode(200)
  @Throttle(LIMIT)
  @ApiOperation({ summary: 'Ask the AI assistant a question about one story (answers only from the coverage)' })
  async chat(@Param('id', ParseIntPipe) id: number, @Body() body: ChatBody) {
    const reply = await this.assistant.chat(id, body.history, body.message, body.lang);
    if (reply === null) throw new NotFoundException(`Story ${id} not found.`);
    return { reply };
  }

  @Post('translate')
  @HttpCode(200)
  @Throttle(LIMIT)
  @ApiOperation({ summary: 'Translate headlines into English or Hindi' })
  async translate(@Body() body: TranslateBody) {
    return { translations: await this.assistant.translate(body.texts, body.target) };
  }
}
