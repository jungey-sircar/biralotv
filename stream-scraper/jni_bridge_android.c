#ifdef __ANDROID__
#include <jni.h>

extern int StartEmbeddedScraper(void);

JNIEXPORT jint JNICALL
Java_com_anonymous_biralotv_ScraperBridge_nativeStart(JNIEnv *env, jclass clazz) {
    (void)env;
    (void)clazz;
    return (jint)StartEmbeddedScraper();
}
#endif

