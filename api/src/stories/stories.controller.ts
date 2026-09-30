import { CacheInterceptor } from '@nestjs/cache-manager';
import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ListStoriesQuery, SearchStoriesQuery } from './stories.dto';
import { StoriesService } from './stories.service';

const CACHE_HEADER = 'public, max-age=60, stale-while-revalidate=300';

@ApiTags('stories')
@Controller('stories')
@UseInterceptors(CacheInterceptor)
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  @Get()
  @Header('Cache-Control', CACHE_HEADER)
  @ApiOperation({ summary: 'Stories covered by several outlets, ranked by coverage and recency' })
  @ApiOkResponse({ description: '{ items: StorySummary[], limit, offset }' })
  list(@Query() query: ListStoriesQuery) {
    return this.stories.list(query);
  }

  @Get('search')
  @Header('Cache-Control', CACHE_HEADER)
  @ApiOperation({ summary: 'Search stories from the last 14 days by headline, in English or Hindi' })
  search(@Query() query: SearchStoriesQuery) {
    return this.stories.search(query.q);
  }

  @Get('blindspots')
  @Header('Cache-Control', CACHE_HEADER)
  @ApiOperation({ summary: 'Stories covered by several outlets in one language and none in the other' })
  blindspots() {
    return this.stories.blindspots();
  }

  @Get(':id')
  @Header('Cache-Control', CACHE_HEADER)
  @ApiOperation({ summary: 'One story: every article, the AI comparison, and coverage over time' })
  @ApiNotFoundResponse({ description: 'No such story (it may have been pruned after 14 days)' })
  async get(@Param('id', ParseIntPipe) id: number) {
    const story = await this.stories.get(id);
    if (!story) throw new NotFoundException(`Story ${id} not found. Stories are kept for 14 days.`);
    return story;
  }

  @Get(':id/related')
  @Header('Cache-Control', CACHE_HEADER)
  @ApiOperation({ summary: 'Stories with the closest embedding centroids (pgvector)' })
  related(@Param('id', ParseIntPipe) id: number) {
    return this.stories.related(id);
  }
}
