/**
 * Native/shared entry: Skia works out of the box on iOS/Android - no
 * CanvasKit loading needed. Web overrides this via SkyMap.web.tsx
 * (Metro resolves the .web.tsx platform file first on web).
 *
 * EXCEPT in Expo Go: Expo Go ships its own embedded Skia native module
 * (version-pinned to the Expo SDK), which is older than the JS in this
 * project - rendering there crashes with "undefined is not a function"
 * inside NativeReanimatedContainer. So under Expo Go we render a pure
 * React Native fallback map instead.
 */
import Constants from 'expo-constants';
import { StyleSheet, Text as RNText, View } from 'react-native';
import { SkyMapCanvas, type SkyMapProps } from './SkyMapCanvas';
const inExpoGo = Constants.appOwnership === 'expo';

function SkyMapFallback({ size }: { size: number }) {
  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      {/* sky dome drawn as a plain dark circle */}
      <View style={[styles.dome, { width: size, height: size, borderRadius: size / 2 }]} />
      <View style={styles.noteWrap} pointerEvents="none">
        <RNText style={styles.noteTitle}>Sky map (basic)</RNText>
        <RNText style={styles.noteBody}>
          The interactive star map needs the native build. In Expo Go only a
          simplified preview is shown.
        </RNText>
      </View>
      <View style={styles.labelN} pointerEvents="none">
        <RNText style={styles.labelText}>N</RNText>
      </View>
      <View style={styles.labelE} pointerEvents="none">
        <RNText style={styles.labelText}>E</RNText>
      </View>
      <View style={styles.labelS} pointerEvents="none">
        <RNText style={styles.labelText}>S</RNText>
      </View>
      <View style={styles.labelW} pointerEvents="none">
        <RNText style={styles.labelText}>W</RNText>
      </View>
    </View>
  );
}

function SkyMap(props: SkyMapProps) {
  if (inExpoGo) return <SkyMapFallback size={props.size} />;
  return <SkyMapCanvas {...props} />;
}

export { SkyMap };

export default SkyMap;

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dome: {
    backgroundColor: '#0A0F22',
    borderWidth: 1.5,
    borderColor: '#3A466E',
  },
  noteWrap: {
    position: 'absolute',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  noteTitle: { color: '#7FD4FF', fontSize: 14, fontWeight: '700', marginBottom: 6 },
  noteBody: { color: '#8D99C4', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  labelN: { position: 'absolute', top: 2, alignSelf: 'center' },
  labelS: { position: 'absolute', bottom: 2, alignSelf: 'center' },
  labelE: { position: 'absolute', right: 6, top: '50%' },
  labelW: { position: 'absolute', left: 6, top: '50%' },
  labelText: { color: '#7FD4FF', fontSize: 12, fontWeight: '700' },
});
