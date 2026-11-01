import { Composition } from 'remotion';
import { Story, Thumb, defaultStory, defaultThumb, storyFrames, storySize, StoryProps } from './Story';

export const Root = () => (
  <>
    <Composition
      id="Story"
      component={Story}
      fps={30}
      width={1080}
      height={1920}
      durationInFrames={90}
      defaultProps={defaultStory}
      calculateMetadata={({ props }) => ({ durationInFrames: storyFrames(props as StoryProps), ...storySize((props as StoryProps).orientation) })}
    />
    <Composition id="Thumb" component={Thumb} fps={30} width={1280} height={720} durationInFrames={1} defaultProps={defaultThumb} />
  </>
);
