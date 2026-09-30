import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export const STORY_FILTERS = ['all', 'both-languages'] as const;
export type StoryFilter = (typeof STORY_FILTERS)[number];

export const SECTIONS = ['all', 'india', 'world'] as const;

export const CATEGORIES = [
  'politics', 'world', 'business', 'sports', 'entertainment', 'technology', 'science', 'health', 'crime',
] as const;

export class ListStoriesQuery {
  @ApiPropertyOptional({ enum: CATEGORIES, description: 'Only stories in this topic.' })
  @IsOptional()
  @IsIn(CATEGORIES)
  category?: (typeof CATEGORIES)[number];

  @ApiPropertyOptional({ enum: SECTIONS, default: 'all', description: '`world`: international news.' })
  @IsOptional()
  @IsIn(SECTIONS)
  section: (typeof SECTIONS)[number] = 'all';

  @ApiPropertyOptional({ default: false, description: 'Only stories with a two-sides debate.' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  debated = false;

  @ApiPropertyOptional({
    enum: STORY_FILTERS,
    default: 'all',
    description: '`both-languages`: only stories covered by at least one English and one Hindi outlet.',
  })
  @IsOptional()
  @IsIn(STORY_FILTERS)
  filter: StoryFilter = 'all';

  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: 2, description: 'Minimum number of outlets.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  minOutlets = 2;

  @ApiPropertyOptional({ minimum: 1, maximum: 336, default: 48, description: 'Only stories updated in this many hours.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(336)
  hours = 48;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @ApiPropertyOptional({ minimum: 0, maximum: 1000, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  offset = 0;
}

export class SearchStoriesQuery {
  @ApiPropertyOptional({ description: 'Words to look for in headlines (English or Hindi), 2-80 characters.' })
  @IsString()
  @Length(2, 80)
  q: string;
}
