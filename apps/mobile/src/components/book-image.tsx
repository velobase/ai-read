import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  PixelRatio,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import { useBookImageFiles, type BookImageReference } from '../adapters/book-media';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import { useLibraryController } from '../library-controller';
import { Button, IconButton, styles } from './ui';

/** EPUB raster dimensions are intrinsic layout units, with no reliable density metadata. */
export function bookImageSize(
  asset: Pick<BookImageReference['asset'], 'width' | 'height'>,
  availableWidth: number,
  availableHeight = Infinity,
) {
  const scale = Math.max(
    0,
    Math.min(1, availableWidth / asset.width, availableHeight / asset.height),
  );
  return { width: asset.width * scale, height: asset.height * scale };
}

export function BookImage({
  image,
  open,
  height,
}: {
  image: BookImageReference;
  open: (image: BookImageReference) => void;
  height?: number;
}) {
  const { colors, t } = useApp();
  const library = useLibrary();
  const { blocked } = useLibraryController();
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const assets = useMemo(() => [image.asset], [image.asset]);
  const files = useBookImageFiles(library, assets);
  const [failed, setFailed] = useState(false);
  const intrinsic = bookImageSize(image.asset, image.asset.width, height);
  return (
    <Pressable
      onPress={(event) => {
        event.stopPropagation();
        if (blockedRef.current || !library.isCurrent()) return;
        open(image);
      }}
      accessibilityRole="imagebutton"
      accessibilityLabel={image.placement.alt || t('bookImage')}
      accessibilityHint={t('openBookImage')}
      style={{
        width: '100%',
        maxWidth: intrinsic.width,
        alignSelf: 'center',
        ...(height !== undefined
          ? { height: intrinsic.height }
          : { aspectRatio: image.asset.width / image.asset.height }),
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#ffffff',
      }}
    >
      {files.ready && !failed ? (
        <Image
          source={{ uri: files.uris[image.asset.id] }}
          resizeMode="contain"
          style={{ width: '100%', height: '100%' }}
          onError={() => setFailed(true)}
          accessible={false}
        />
      ) : files.error || failed ? (
        <View style={{ gap: 8, padding: 10 }}>
          <Text style={{ color: colors.error }}>{t('bookImageError')}</Text>
          <Button
            secondary
            onPress={() => {
              if (blockedRef.current || !library.isCurrent()) return;
              setFailed(false);
              files.retry();
            }}
          >
            {t('retry')}
          </Button>
        </View>
      ) : (
        <ActivityIndicator color={colors.accent} />
      )}
    </Pressable>
  );
}

/** Width-fit initial view keeps tall charts readable; vertical scrolling never crops the source. */
export function BookImageViewer({
  image,
  visible = true,
  onShow,
  onDismiss,
  close,
}: {
  image: BookImageReference;
  visible?: boolean;
  onShow?: () => void;
  onDismiss?: () => void;
  close: () => void;
}) {
  const { colors, t } = useApp();
  const library = useLibrary();
  const { blocked } = useLibraryController();
  const inaccessible = blocked || !visible || !library.isCurrent();
  const blockedRef = useRef(inaccessible);
  blockedRef.current = inaccessible;
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Keep the Image's decode frame at source resolution, but give the scroll view
  // a genuinely width-fitted canvas. Its initial zoomScale below 1 is not reliable.
  const sourceWidth = image.asset.width / PixelRatio.get();
  const sourceHeight = image.asset.height / PixelRatio.get();
  const fittedZoom = width > 0 ? width / sourceWidth : 1;
  return (
    <Modal
      visible={!inaccessible}
      onShow={onShow}
      onDismiss={onDismiss}
      presentationStyle="fullScreen"
      animationType={blocked ? 'none' : 'fade'}
      onRequestClose={close}
    >
      <SafeAreaProvider
        initialMetrics={initialWindowMetrics}
        style={{ flex: 1, backgroundColor: colors.surface, opacity: inaccessible ? 0 : 1 }}
        pointerEvents={inaccessible ? 'none' : 'auto'}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
          <View style={[styles.sheetHeader, { borderColor: colors.border }]}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text
                accessibilityRole="header"
                numberOfLines={2}
                style={{ color: colors.ink, fontSize: 17 }}
              >
                {image.placement.alt || t('bookImage')}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{t('bookImageHint')}</Text>
            </View>
            <IconButton icon="close" label={t('close')} onPress={close} />
          </View>
          <View style={{ flex: 1 }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
            {failed ? (
              <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16 }}>
                <Text style={{ color: colors.error }}>{t('bookImageError')}</Text>
                <Button
                  onPress={() => {
                    if (blockedRef.current || !library.isCurrent()) return;
                    setFailed(false);
                    setAttempt((n) => n + 1);
                  }}
                >
                  {t('retry')}
                </Button>
              </View>
            ) : width > 0 ? (
              <ScrollView
                key={`${image.placement.id}:${width}:${attempt}`}
                maximumZoomScale={4}
                minimumZoomScale={1}
                zoomScale={1}
                pinchGestureEnabled
                centerContent
                contentContainerStyle={{ width, height: sourceHeight * fittedZoom }}
              >
                <View
                  style={{
                    width,
                    height: sourceHeight * fittedZoom,
                    overflow: 'hidden',
                    backgroundColor: '#ffffff',
                  }}
                >
                  <Image
                    source={{ uri: image.asset.dataUri }}
                    accessibilityLabel={image.placement.alt || t('bookImage')}
                    resizeMode="contain"
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      width: sourceWidth,
                      height: sourceHeight,
                      transformOrigin: 'top left',
                      transform: [{ scale: fittedZoom }],
                    }}
                    onError={() => setFailed(true)}
                  />
                </View>
              </ScrollView>
            ) : null}
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
