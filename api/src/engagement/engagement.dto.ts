import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

const clean = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim() : value;

export class NewCommentBody {
  @ApiPropertyOptional({ maxLength: 40, description: 'Display name; "Anonymous reader" if empty.' })
  @IsOptional()
  @Transform(clean)
  @IsString()
  @MaxLength(40)
  name?: string;

  @ApiProperty({ minLength: 2, maxLength: 1000 })
  @Transform(clean)
  @IsString()
  @Length(2, 1000)
  body: string;

  /** Honeypot: hidden in the form. People leave it empty; naive bots fill it in. */
  @ApiPropertyOptional({ description: 'Leave empty.' })
  @IsOptional()
  @IsString()
  website?: string;
}

export const SIDES = ['for', 'against', 'unsure'] as const;
export type Side = (typeof SIDES)[number];

export class VoteBody {
  @ApiProperty({ enum: SIDES })
  @IsIn(SIDES)
  side: Side;
}

export const FEEDBACK_KINDS = [
  'wrong_grouping',
  'wrong_summary',
  'missing_side',
  'unfair',
  'bad_translation',
  'broken_link',
  'other',
] as const;

export class FeedbackBody {
  @ApiProperty({ enum: FEEDBACK_KINDS })
  @IsIn(FEEDBACK_KINDS)
  kind: (typeof FEEDBACK_KINDS)[number];

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(clean)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CommentsQuery {
  @ApiPropertyOptional({ enum: ['new', 'top'], default: 'new' })
  @IsOptional()
  @IsIn(['new', 'top'])
  sort: 'new' | 'top' = 'new';
}
